// Gift vouchers: a prepaid dollar balance, NOT a percentage discount (that's
// promo_codes). Each voucher carries a face value and a remaining balance —
// partial redemptions are normal, so the two are tracked separately and the
// outstanding balance is a real liability the business owes.
import { rest, restError } from "./supabase";
import { voucherProblem, type RedeemContext, type Voucher } from "./voucher-types";

export type { Voucher } from "./voucher-types";
export { voucherTotals, voucherProblem } from "./voucher-types";

type VoucherRow = {
  code: string;
  face_cents: number;
  remaining_cents: number;
  active: boolean;
  created_at: string;
  purchaser: string | null;
  email: string | null;
  message?: string | null;
  last_used_at: string | null;
  redemption_type?: string;
  spaces_total?: number | null;
  spaces_left?: number | null;
  one_time_use?: boolean;
  items_scope?: string;
  item_ids?: string[];
  date_option?: string;
  date_from?: string | null;
  date_to?: string | null;
  time_option?: string;
  time_from?: string | null;
  time_to?: string | null;
  days_of_week?: number[];
  exclusion_dates?: string[];
  expiry_date?: string | null;
  kind?: string;
};

function toVoucher(r: VoucherRow): Voucher {
  return {
    code: r.code,
    faceCents: r.face_cents,
    remainingCents: r.remaining_cents,
    active: r.active,
    createdAt: r.created_at,
    purchaser: r.purchaser,
    email: r.email,
    message: r.message ?? null,
    lastUsedAt: r.last_used_at,
    kind: r.kind === "purchased" ? "purchased" : "comp",
    redemptionType: r.redemption_type === "spaces" ? "spaces" : "value",
    spacesTotal: r.spaces_total ?? null,
    spacesLeft: r.spaces_left ?? null,
    oneTimeUse: r.one_time_use === true,
    itemsScope: r.items_scope === "selected" ? "selected" : "all",
    itemIds: r.item_ids ?? [],
    dateOption: r.date_option === "range" ? "range" : "any",
    dateFrom: r.date_from ?? null,
    dateTo: r.date_to ?? null,
    timeOption: r.time_option === "range" ? "range" : "any",
    timeFrom: r.time_from ?? null,
    timeTo: r.time_to ?? null,
    daysOfWeek: r.days_of_week ?? [0, 1, 2, 3, 4, 5, 6],
    exclusionDates: r.exclusion_dates ?? [],
    expiryDate: r.expiry_date ?? null,
  };
}

// Only what a row in the list actually renders. The redemption rules —
// day/date/time windows, item lists, exclusions — are a large share of each
// record and are needed on the detail screen alone, so shipping them to a
// browser showing 60 rows was pure weight.
const LIST_COLS =
  "code,face_cents,remaining_cents,active,created_at,purchaser,email,last_used_at,redemption_type,spaces_left,kind";

// PostgREST caps a response at 1,000 rows, so page through — there are already
// more vouchers than that, and a silent truncation would understate the
// outstanding balance the business owes.
const PAGE_SIZE = 1000;

export type VoucherQuery = {
  q?: string;
  status?: "all" | "active" | "inactive" | "unspent" | "partial" | "spent";
  limit?: number;
  offset?: number;
};

export type VoucherPage = { rows: Voucher[]; total: number };

// Searching and paging happen in the database. With a couple of thousand codes
// on the books, handing the whole table to the browser to filter in JavaScript
// meant a megabyte on every page load.
export async function listVoucherPage(query: VoucherQuery = {}): Promise<VoucherPage> {
  const limit = Math.min(Math.max(query.limit ?? 60, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  const parts = [`select=${LIST_COLS}`, "order=created_at.desc", `limit=${limit}`, `offset=${offset}`];

  switch (query.status) {
    case "active":
      parts.push("active=is.true");
      break;
    case "inactive":
      parts.push("active=is.false");
      break;
    case "unspent":
    case "partial":
    case "spent":
      parts.push(`spend_state=eq.${query.status}`);
      break;
    default:
      break;
  }

  const q = (query.q ?? "").trim();
  if (q) {
    // Commas and parens would break out of the or() grouping, so drop them.
    const safe = q.replace(/[(),*]/g, "").slice(0, 80);
    if (safe) {
      const like = `*${safe}*`;
      parts.push(`or=(code.ilike.${like},purchaser.ilike.${like},email.ilike.${like})`);
    }
  }

  // Prefer: count=exact gives the match count in the Content-Range header, so
  // the UI can say "60 of 1,802" without a second round trip.
  const res = await rest(`gift_vouchers?${parts.join("&")}`, { headers: { Prefer: "count=exact" } });
  if (!res.ok) throw await restError(res, "Loading gift vouchers");
  const rows = ((await res.json()) as VoucherRow[]).map(toVoucher);
  const range = res.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]) || rows.length;
  return { rows, total };
}

// Totals across every voucher, summed in the database rather than by pulling
// the table into memory.
export async function voucherTotalsFromDb(): Promise<{
  total: number;
  face: number;
  outstanding: number;
  live: number;
}> {
  const res = await rest("rpc/voucher_totals", { method: "POST", body: "{}" });
  if (!res.ok) throw await restError(res, "Totalling gift vouchers");
  return (await res.json()) as { total: number; face: number; outstanding: number; live: number };
}

// Per-denomination sales figures for the catalogue, grouped in the database.
export async function productStatsFromDb(): Promise<Record<number, { issued: number; spent: number; valueCents: number }>> {
  const res = await rest("rpc/voucher_product_stats", { method: "POST", body: "{}" });
  if (!res.ok) throw await restError(res, "Summarising gift vouchers");
  const rows = (await res.json()) as { face_cents: number; issued: number; spent: number; value_cents: number }[];
  const out: Record<number, { issued: number; spent: number; valueCents: number }> = {};
  for (const r of rows) {
    out[r.face_cents] = { issued: Number(r.issued), spent: Number(r.spent), valueCents: Number(r.value_cents) };
  }
  return out;
}

export async function listVouchers(): Promise<Voucher[]> {
  const out: Voucher[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const res = await rest(
      `gift_vouchers?select=${LIST_COLS}&order=created_at.desc&limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (!res.ok) throw await restError(res, "Loading gift vouchers");
    const rows = (await res.json()) as VoucherRow[];
    out.push(...rows.map(toVoucher));
    if (rows.length < PAGE_SIZE) return out;
  }
}

export async function getVoucher(code: string): Promise<Voucher | undefined> {
  const res = await rest(`gift_vouchers?code=eq.${encodeURIComponent(code)}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Loading that gift voucher");
  const rows = (await res.json()) as VoucherRow[];
  return rows[0] ? toVoucher(rows[0]) : undefined;
}

// A voucher with nothing left on it is finished, so it goes inactive and stays
// that way. Keeps staff from seeing live-looking codes worth nothing, and
// stops a spent code being switched back on by accident.
function isSpent(v: { redemptionType: string; remainingCents: number; spacesLeft: number | null }): boolean {
  return v.redemptionType === "spaces" ? (v.spacesLeft ?? 0) <= 0 : v.remainingCents <= 0;
}

async function patchVoucher(code: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await rest(`gift_vouchers?code=eq.${encodeURIComponent(code)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await restError(res, "Updating that gift voucher");
  return ((await res.json()) as VoucherRow[]).length > 0;
}

export async function setVoucherActive(code: string, active: boolean): Promise<boolean> {
  if (active) {
    const v = await getVoucher(code);
    if (!v) return false;
    if (isSpent(v)) return patchVoucher(code, { active: false }); // nothing left to activate
  }
  return patchVoucher(code, { active });
}

// Everything editable on the voucher screen. Face value and balance are
// deliberately NOT here — money moves only through redemption.
export type VoucherSettings = Pick<
  Voucher,
  | "redemptionType"
  | "spacesTotal"
  | "spacesLeft"
  | "oneTimeUse"
  | "itemsScope"
  | "itemIds"
  | "dateOption"
  | "dateFrom"
  | "dateTo"
  | "timeOption"
  | "timeFrom"
  | "timeTo"
  | "daysOfWeek"
  | "exclusionDates"
  | "expiryDate"
  | "active"
>;

export async function saveVoucherSettings(code: string, s: VoucherSettings): Promise<boolean> {
  const current = await getVoucher(code);
  return patchVoucher(code, {
    redemption_type: s.redemptionType,
    spaces_total: s.spacesTotal,
    spaces_left: s.spacesLeft,
    one_time_use: s.oneTimeUse,
    items_scope: s.itemsScope,
    item_ids: s.itemsScope === "selected" ? s.itemIds : [],
    date_option: s.dateOption,
    date_from: s.dateOption === "range" ? s.dateFrom : null,
    date_to: s.dateOption === "range" ? s.dateTo : null,
    time_option: s.timeOption,
    time_from: s.timeOption === "range" ? s.timeFrom : null,
    time_to: s.timeOption === "range" ? s.timeTo : null,
    days_of_week: s.daysOfWeek,
    exclusion_dates: s.exclusionDates,
    expiry_date: s.expiryDate,
    // A fully spent voucher can't be reactivated from the settings screen.
    active: s.active && !isSpent(s.redemptionType === "spaces"
      ? { redemptionType: "spaces", remainingCents: 0, spacesLeft: s.spacesLeft }
      : { redemptionType: "value", remainingCents: current?.remainingCents ?? 1, spacesLeft: null }),
  });
}

export type RedeemResult =
  | { ok: true; spent: number; remainingCents: number; spacesLeft: number | null; forfeitedCents: number }
  | { ok: false; error: string };

// Spend against a voucher. Every rule from the voucher screen is re-checked
// here, so the settings are real constraints no matter which surface calls in.
export async function redeemVoucher(
  code: string,
  amount: number, // cents, or a number of spaces when redemptionType is "spaces"
  ctx: RedeemContext
): Promise<RedeemResult> {
  const v = await getVoucher(code);
  if (!v) return { ok: false, error: "No voucher with that code." };

  const problem = voucherProblem(v, ctx);
  if (problem) return { ok: false, error: problem };
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }

  if (v.redemptionType === "spaces") {
    const left = v.spacesLeft ?? 0;
    if (amount > left) return { ok: false, error: `Only ${left} space(s) left on this voucher.` };
    // One-time use burns whatever is left, however little was actually spent.
    const after = v.oneTimeUse ? 0 : left - amount;
    await patchVoucher(code, {
      spaces_left: after,
      last_used_at: new Date().toISOString(),
      ...(after <= 0 ? { active: false } : {}),
    });
    return { ok: true, spent: amount, remainingCents: v.remainingCents, spacesLeft: after, forfeitedCents: 0 };
  }

  if (amount > v.remainingCents) {
    return { ok: false, error: `Only $${(v.remainingCents / 100).toFixed(2)} left on this voucher.` };
  }
  const after = v.oneTimeUse ? 0 : v.remainingCents - amount;
  const forfeited = v.oneTimeUse ? v.remainingCents - amount : 0;
  await patchVoucher(code, {
    remaining_cents: after,
    last_used_at: new Date().toISOString(),
    ...(after <= 0 ? { active: false } : {}),
  });
  return { ok: true, spent: amount, remainingCents: after, spacesLeft: v.spacesLeft, forfeitedCents: forfeited };
}
