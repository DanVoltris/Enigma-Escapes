// Invoices raised before a booking exists.
//
// A quote is deliberately NOT a booking: it holds no slot and takes no money.
// A corporate customer needs a document with a GST number on it to get payment
// approved, which can take weeks — the session is only secured when someone
// pays and the booking is actually made. The invoice says so in as many words
// (see renderDocument), because the alternative is an argument later.
import { randomUUID } from "crypto";
import { rest, restError } from "./supabase";
import { todayISO } from "./format";

export type QuoteLine = {
  roomName: string;
  location: string;
  date: string | null; // ISO, optional — a quote may name no date yet
  time: string | null; // HH:MM
  quantity: number;
  unitCents: number;
};

export type QuoteCustomer = {
  name: string;
  email: string;
  phone: string;
  company: string;
};

export type Quote = {
  id: string;
  number: string;
  token: string; // the secret in the public link
  createdAt: string;
  createdBy: string;
  customer: QuoteCustomer;
  lines: QuoteLine[];
  discountCents: number;
  taxPercent: number;
  note: string;
  status: "draft" | "sent" | "void";
  sentAt: string | null;
  sentTo: string | null;
  expiresOn: string | null;
};

type Row = {
  id: string;
  number: string;
  token: string;
  created_at: string;
  created_by: string | null;
  customer: QuoteCustomer;
  lines: QuoteLine[];
  discount_cents: number;
  tax_percent: number;
  note: string | null;
  status: Quote["status"];
  sent_at: string | null;
  sent_to: string | null;
  expires_on: string | null;
};

function toQuote(r: Row): Quote {
  return {
    id: r.id,
    number: r.number,
    token: r.token,
    createdAt: r.created_at,
    createdBy: r.created_by ?? "",
    customer: r.customer,
    lines: Array.isArray(r.lines) ? r.lines : [],
    discountCents: Number(r.discount_cents ?? 0),
    taxPercent: Number(r.tax_percent ?? 0),
    note: r.note ?? "",
    status: r.status,
    sentAt: r.sent_at,
    sentTo: r.sent_to,
    expiresOn: r.expires_on,
  };
}

// Money is recomputed from the stored lines every time it is shown, never read
// back from a saved total — the same rule the booking side follows.
export function quoteTotals(q: Pick<Quote, "lines" | "discountCents" | "taxPercent">): {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
} {
  const subtotalCents = q.lines.reduce((n, l) => n + Math.round(l.unitCents * l.quantity), 0);
  const discountCents = Math.min(Math.max(0, Math.round(q.discountCents)), subtotalCents);
  const taxable = subtotalCents - discountCents;
  const taxCents = Math.round((taxable * q.taxPercent) / 100);
  return { subtotalCents, discountCents, taxCents, totalCents: taxable + taxCents };
}

export function lineTotal(l: QuoteLine): number {
  return Math.round(l.unitCents * l.quantity);
}

// INV-XXXXXX from the uuid, so two staff raising a quote at once can't collide
// the way a counter would.
function newNumber(): string {
  return `INV-${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export async function listQuotes(): Promise<Quote[]> {
  const res = await rest("quotes?select=*&order=created_at.desc&limit=300");
  if (res.status === 404) return []; // table not created yet
  if (!res.ok) throw await restError(res, "Loading invoices");
  return ((await res.json()) as Row[]).map(toQuote);
}

export async function getQuote(id: string): Promise<Quote | null> {
  const res = await rest(`quotes?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (res.status === 404) return null;
  if (!res.ok) throw await restError(res, "Loading the invoice");
  const rows = (await res.json()) as Row[];
  return rows[0] ? toQuote(rows[0]) : null;
}

// The public page is reached by token, never by id — same shape as the
// customer's own booking link.
export async function getQuoteByToken(token: string): Promise<Quote | null> {
  const res = await rest(`quotes?select=*&token=eq.${encodeURIComponent(token)}&limit=1`);
  if (res.status === 404) return null;
  if (!res.ok) throw await restError(res, "Loading the invoice");
  const rows = (await res.json()) as Row[];
  return rows[0] ? toQuote(rows[0]) : null;
}

export async function createQuote(input: {
  customer: QuoteCustomer;
  lines: QuoteLine[];
  discountCents: number;
  taxPercent: number;
  note: string;
  expiresOn: string | null;
  createdBy: string;
}): Promise<Quote> {
  const row = {
    id: randomUUID(),
    number: newNumber(),
    token: randomUUID().replace(/-/g, ""),
    created_at: new Date().toISOString(),
    created_by: input.createdBy,
    customer: input.customer,
    lines: input.lines,
    discount_cents: Math.max(0, Math.round(input.discountCents)),
    tax_percent: Math.max(0, input.taxPercent),
    note: input.note,
    status: "draft" as const,
    sent_at: null,
    sent_to: null,
    expires_on: input.expiresOn,
  };
  const res = await rest("quotes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw await restError(res, "Saving the invoice");
  const rows = (await res.json()) as Row[];
  return toQuote(rows[0]);
}

export async function markQuoteSent(id: string, to: string): Promise<void> {
  const res = await rest(`quotes?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), sent_to: to }),
  });
  if (!res.ok) throw await restError(res, "Updating the invoice");
}

export async function voidQuote(id: string): Promise<void> {
  const res = await rest(`quotes?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "void" }),
  });
  if (!res.ok) throw await restError(res, "Voiding the invoice");
}

// A quote past its date is stale rather than deleted: staff still need to see
// what was sent and when.
export function isExpired(q: Quote): boolean {
  return Boolean(q.expiresOn && q.expiresOn < todayISO());
}

// Which venues an invoice touches. A quote has no single location — a corporate
// group can take rooms at two sites on one document — so it is the set across
// its lines, and a hand-typed line (catering, room hire) contributes none.
export function quoteLocations(q: Pick<Quote, "lines">): string[] {
  return [...new Set(q.lines.map((l) => l.location.trim()).filter(Boolean))];
}

// Whether an account limited to certain venues may see this invoice.
//
// `scope` of null means the account sees everything. An invoice naming no venue
// at all belongs to the business rather than to a site, so it stays visible —
// hiding it would strand invoices for things that happen at no particular room.
export function visibleToScope(q: Pick<Quote, "lines">, scope: string[] | null): boolean {
  if (!scope) return true;
  const locs = quoteLocations(q);
  if (locs.length === 0) return true;
  return locs.some((l) => scope.includes(l));
}
