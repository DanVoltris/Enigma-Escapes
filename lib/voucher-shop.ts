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
