// Invoices and receipts: one renderer, used both for the email body and for
// the printable web page, so what a customer reads in their inbox and what
// they print are the same document rather than two things that drift.
//
// Written as inline-styled HTML on purpose. Email clients strip <style> blocks
// and know nothing of CSS variables or flexbox, so the site's stylesheet is no
// use here — Outlook still wants tables and inline styles.
import { formatDateLong, formatMoney, formatTime } from "./format";
import type { BusinessDetails } from "./settings";

export type DocumentKind = "invoice" | "receipt";

export type DocumentLine = {
  roomName: string;
  location?: string | null;
  date?: string | null; // ISO
  time?: string | null; // HH:MM
  quantity: number;
  unitCents: number;
  lineCents: number;
};

export type DocumentTotals = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  taxLabel: string; // "GST"
  totalCents: number;
  paidCents?: number;
  balanceCents?: number;
};

export type DocumentData = {
  kind: DocumentKind;
  number: string; // what the customer quotes back at you
  issuedOn: string; // ISO date
  customerName: string;
  customerEmail: string;
  lines: DocumentLine[];
  totals: DocumentTotals;
  note?: string | null;
  viewUrl?: string | null; // the printable page
  business: BusinessDetails;
  logoUrl?: string | null;
  accent?: string | null;
};

const INK = "#16212b";
const MUTED = "#5b6670";
const LINE = "#dfe4e8";

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function when(l: DocumentLine): string {
  if (!l.date) return "";
  const day = formatDateLong(l.date);
  return l.time ? `${day} at ${formatTime(l.time)}` : day;
}

function row(label: string, value: string, opts: { bold?: boolean; big?: boolean } = {}): string {
  const weight = opts.bold ? "700" : "400";
  const size = opts.big ? "18px" : "15px";
  return `<tr>
    <td style="padding:6px 0;color:${MUTED};font-size:15px;">${esc(label)}</td>
    <td align="right" style="padding:6px 0;color:${INK};font-size:${size};font-weight:${weight};white-space:nowrap;">${esc(value)}</td>
  </tr>`;
}

// The whole document as one self-contained HTML string.
export function renderDocument(d: DocumentData): string {
  const isInvoice = d.kind === "invoice";
  const title = isInvoice ? "Invoice" : "Receipt";
  const b = d.business;
  const accent = d.accent || "#16212b";

  // The logo is fitted inside a box rather than given a fixed height: Enigma's
  // is square, another venue's may be a wide wordmark, and pinning one
  // dimension while capping the other stretches whichever doesn't match. The
  // width attribute is only there for Outlook, which ignores max-width.
  const contact = [b.address, b.phone, b.email, b.website].filter((x) => x && x.trim()).map((x) => esc(x!.trim()));

  const lines = d.lines
    .map((l) => {
      const sub = [l.location, when(l)].filter(Boolean).join(" · ");
      return `<tr>
        <td style="padding:12px 0;border-bottom:1px solid ${LINE};vertical-align:top;">
          <div style="color:${INK};font-size:15px;font-weight:600;">${esc(l.roomName)}</div>
          ${sub ? `<div style="color:${MUTED};font-size:13px;padding-top:2px;">${esc(sub)}</div>` : ""}
        </td>
        <td align="center" style="padding:12px 8px;border-bottom:1px solid ${LINE};color:${INK};font-size:15px;vertical-align:top;white-space:nowrap;">${l.quantity}</td>
        <td align="right" style="padding:12px 8px;border-bottom:1px solid ${LINE};color:${MUTED};font-size:15px;vertical-align:top;white-space:nowrap;">${esc(formatMoney(l.unitCents))}</td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:15px;vertical-align:top;white-space:nowrap;">${esc(formatMoney(l.lineCents))}</td>
      </tr>`;
    })
    .join("");

  const t = d.totals;
  const totals = [
    row("Subtotal", formatMoney(t.subtotalCents)),
    t.discountCents > 0 ? row("Discount", `-${formatMoney(t.discountCents)}`) : "",
    t.taxCents > 0 ? row(t.taxLabel || "Tax", formatMoney(t.taxCents)) : "",
    `<tr><td colspan="2" style="padding:4px 0;"><div style="border-top:1px solid ${LINE};"></div></td></tr>`,
    row("Total", formatMoney(t.totalCents), { bold: true, big: true }),
    typeof t.paidCents === "number" && t.paidCents > 0 ? row("Paid", formatMoney(t.paidCents)) : "",
    typeof t.balanceCents === "number" && t.balanceCents > 0
      ? row(isInvoice ? "Amount due" : "Balance due", formatMoney(t.balanceCents), { bold: true })
      : "",
  ]
    .filter(Boolean)
    .join("");

  // An invoice is not a booking: nothing is held until it is paid and booked,
  // and saying so here is what stops a customer assuming their slot is safe
  // while their accounts department takes a fortnight.
  const standardNote = isInvoice
    ? "This invoice does not reserve a session. Your time is confirmed once payment is made and the booking is created."
    : "Thank you — this is your receipt. Please keep it for your records.";

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} ${esc(d.number)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f5f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};">
  <tr><td style="padding:28px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:top;width:55%;">
        ${d.logoUrl ? `<img src="${esc(d.logoUrl)}" alt="${esc(b.companyName)}" width="130" style="display:block;width:auto;height:auto;max-width:210px;max-height:130px;border:0;">` : `<div style="font-size:26px;font-weight:700;color:${INK};">${esc(b.companyName)}</div>`}
      </td>
      <td align="right" style="vertical-align:top;">
        <div style="font-size:22px;font-weight:700;color:${accent};letter-spacing:0.02em;">${esc(title.toUpperCase())}</div>
        <div style="font-size:14px;color:${MUTED};padding-top:4px;">${esc(d.number)}</div>
        <div style="font-size:14px;color:${MUTED};">${esc(formatDateLong(d.issuedOn))}</div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:24px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:top;width:50%;">
        <div style="font-size:12px;font-weight:700;color:${MUTED};letter-spacing:0.06em;">FROM</div>
        <div style="font-size:15px;font-weight:600;color:${INK};padding-top:6px;">${esc(b.companyName)}</div>
        ${contact.map((c) => `<div style="font-size:14px;color:${MUTED};padding-top:2px;">${c}</div>`).join("")}
        ${b.taxNumber ? `<div style="font-size:14px;color:${MUTED};padding-top:6px;">${esc(b.taxLabel || "GST")} No. ${esc(b.taxNumber)}</div>` : ""}
      </td>
      <td style="vertical-align:top;width:50%;">
        <div style="font-size:12px;font-weight:700;color:${MUTED};letter-spacing:0.06em;">${isInvoice ? "BILL TO" : "RECEIVED FROM"}</div>
        <div style="font-size:15px;font-weight:600;color:${INK};padding-top:6px;">${esc(d.customerName)}</div>
        <div style="font-size:14px;color:${MUTED};padding-top:2px;">${esc(d.customerEmail)}</div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:24px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding-bottom:6px;font-size:12px;font-weight:700;color:${MUTED};letter-spacing:0.06em;border-bottom:2px solid ${INK};">DESCRIPTION</td>
        <td align="center" style="padding-bottom:6px;font-size:12px;font-weight:700;color:${MUTED};letter-spacing:0.06em;border-bottom:2px solid ${INK};">QTY</td>
        <td align="right" style="padding-bottom:6px;font-size:12px;font-weight:700;color:${MUTED};letter-spacing:0.06em;border-bottom:2px solid ${INK};">EACH</td>
        <td align="right" style="padding-bottom:6px;font-size:12px;font-weight:700;color:${MUTED};letter-spacing:0.06em;border-bottom:2px solid ${INK};">AMOUNT</td>
      </tr>
      ${lines}
    </table>
  </td></tr>

  <tr><td style="padding:16px 28px 0;">
    <table role="presentation" align="right" cellpadding="0" cellspacing="0" style="width:60%;min-width:240px;">${totals}</table>
  </td></tr>

  <tr><td style="padding:28px;">
    ${d.note ? `<div style="font-size:14px;color:${INK};padding-bottom:12px;white-space:pre-wrap;">${esc(d.note)}</div>` : ""}
    <div style="font-size:13px;color:${MUTED};line-height:1.5;">${esc(standardNote)}</div>
    ${d.viewUrl ? `<div style="padding-top:14px;"><a href="${esc(d.viewUrl)}" style="color:${accent};font-size:14px;font-weight:600;">View or print this ${esc(title.toLowerCase())} →</a></div>` : ""}
  </td></tr>
</table>
<div style="max-width:640px;margin:12px auto 0;font-size:12px;color:${MUTED};text-align:center;">
  ${esc(b.companyName)}${b.address ? ` · ${esc(b.address)}` : ""}
</div>
</body></html>`;
}

// Subject lines, kept next to the renderer so the two never disagree.
export function documentSubject(d: DocumentData): string {
  const what = d.kind === "invoice" ? "Invoice" : "Receipt";
  return `${what} ${d.number} — ${d.business.companyName}`;
}
