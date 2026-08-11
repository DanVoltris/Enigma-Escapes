// Selling gift vouchers on the public site. Kept apart from lib/vouchers.ts
// (the staff-side manager) because this is the only code path that MINTS a
// voucher, and it must never trust an amount that came from the browser.
import { randomInt } from "crypto";
import { rest, restError } from "./supabase";

export { DENOMINATIONS_CENTS, isSellableAmount } from "./voucher-shop-config";

// Unambiguous alphabet: no O/0, I/1, S/5 — these get read aloud over the phone
// and copied off printed cards.
const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";

function block(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

async function codeExists(code: string): Promise<boolean> {
  const res = await rest(`gift_vouchers?code=eq.${encodeURIComponent(code)}&select=code&limit=1`);
  if (!res.ok) throw await restError(res, "Checking that voucher code");
  return ((await res.json()) as unknown[]).length > 0;
}

// EE-XXXX-XXXX, retried until it's unique. 30^8 combinations, so a collision
// is vanishingly unlikely — but a duplicate code would hand someone else's
// balance to the wrong customer, so it's checked rather than assumed.
export async function generateVoucherCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = `EE-${block(4)}-${block(4)}`;
    if (!(await codeExists(code))) return code;
  }
  throw new Error("Could not generate a unique voucher code");
}

// Mints the voucher for a paid Stripe session, exactly once. The webhook and
// the customer returning from Stripe both call this; the unique index on
// stripe_session_id means the loser of that race just reads back the winner's
// voucher instead of issuing a second one.
export async function fulfilVoucherSession(session: {
  id: string;
  amountCents: number;
  buyerName: string;
  buyerEmail: string;
  recipientEmail: string | null;
  message: string | null;
}): Promise<string> {
  const existing = await rest(
    `gift_vouchers?stripe_session_id=eq.${encodeURIComponent(session.id)}&select=code&limit=1`
  );
  if (!existing.ok) throw await restError(existing, "Looking up that gift voucher");
  const found = (await existing.json()) as { code: string }[];
  if (found[0]) return found[0].code;

  const code = await generateVoucherCode();
  const res = await rest("gift_vouchers?on_conflict=stripe_session_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      code,
      face_cents: session.amountCents,
      remaining_cents: session.amountCents,
      active: true,
      created_at: new Date().toISOString(),
      purchaser: session.buyerName,
      email: session.buyerEmail,
      recipient_email: session.recipientEmail,
      message: session.message,
      source: "online",
      kind: "purchased",
      stripe_session_id: session.id,
    }),
  });
  if (!res.ok) throw await restError(res, "Creating that gift voucher");

  // Read back rather than trust our own insert — if the other caller won the
  // race, ours was ignored and theirs is the real code.
  const after = await rest(
    `gift_vouchers?stripe_session_id=eq.${encodeURIComponent(session.id)}&select=code&limit=1`
  );
  if (!after.ok) throw await restError(after, "Confirming that gift voucher");
  const rows = (await after.json()) as { code: string }[];
  return rows[0]?.code ?? code;
}

// A staff-issued giveaway code. Same dollar balance as a purchased voucher,
// but marked "comp" so it files under Promo codes rather than Gift vouchers.
// Returns the code, or null when the requested one is already taken.
export async function createStaffCode(input: {
  code?: string;
  amountCents: number;
  note: string | null;
  createdBy: string;
}): Promise<string | null> {
  const code = input.code ?? (await generateVoucherCode());
  if (input.code && (await codeExists(input.code))) return null;

  const res = await rest("gift_vouchers", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      code,
      face_cents: input.amountCents,
      remaining_cents: input.amountCents,
      active: true,
      created_at: new Date().toISOString(),
      purchaser: input.createdBy,
      message: input.note,
      source: "manual",
      kind: "comp",
    }),
  });
  // A racing insert on the same code trips the primary key — report it as taken.
  if (res.status === 409) return null;
  if (!res.ok) throw await restError(res, "Creating that code");
  return code;
}

export type PurchaseInput = {
  amountCents: number;
  buyerName: string;
  buyerEmail: string;
  recipientEmail: string | null;
  message: string | null;
};

// Creates the voucher at full face value, active, with the same permissive
// defaults as the imported ones (any experience, any date, no expiry).
export async function createPurchasedVoucher(input: PurchaseInput): Promise<string> {
  const code = await generateVoucherCode();
  const res = await rest("gift_vouchers", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      code,
      face_cents: input.amountCents,
      remaining_cents: input.amountCents,
      active: true,
      created_at: new Date().toISOString(),
      purchaser: input.buyerName,
      email: input.buyerEmail,
      recipient_email: input.recipientEmail,
      message: input.message,
      source: "online",
      kind: "purchased",
    }),
  });
  if (!res.ok) throw await restError(res, "Creating that gift voucher");
  return code;
}
