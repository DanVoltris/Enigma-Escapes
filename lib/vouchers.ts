// Gift vouchers: a prepaid dollar balance, NOT a percentage discount (that's
// promo_codes). Each voucher carries a face value and a remaining balance —
// partial redemptions are normal, so the two are tracked separately and the
// outstanding balance is a real liability the business owes.
import { rest, restError } from "./supabase";
import type { Voucher } from "./voucher-types";

export type { Voucher } from "./voucher-types";
export { voucherTotals } from "./voucher-types";

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
  };
}

// PostgREST caps a response at 1,000 rows, so page through — there are already
// more vouchers than that, and a silent truncation would understate the
// outstanding balance the business owes.
const PAGE_SIZE = 1000;

export async function listVouchers(): Promise<Voucher[]> {
  // `message` is never shown in the portal; leaving it out keeps the payload
  // sent to the browser small enough for instant client-side search.
  const cols = "code,face_cents,remaining_cents,active,created_at,purchaser,email,last_used_at";
  const out: Voucher[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const res = await rest(
      `gift_vouchers?select=${cols}&order=created_at.desc&limit=${PAGE_SIZE}&offset=${offset}`
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

export async function setVoucherActive(code: string, active: boolean): Promise<boolean> {
  const res = await rest(`gift_vouchers?code=eq.${encodeURIComponent(code)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ active }),
  });
  if (!res.ok) throw await restError(res, "Updating that gift voucher");
  return ((await res.json()) as VoucherRow[]).length > 0;
}
