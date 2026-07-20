import type { CartItem, PaymentOption } from "./types";

export const HOLD_MINUTES = 15;
export const BOOKING_WINDOW_DAYS = 60;
export const MIN_PARTY_SIZE = 4; // default smallest group for a new experience
export const DEFAULT_TAX_PERCENT = 5; // fallback if the tax config can't be read
export const DEFAULT_DEPOSIT_PERCENT = 25; // fallback for items saved before deposits were configurable

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  gstCents: number; // tax amount (from the configured taxes)
  totalCents: number;
  depositCents: number;
};

// Spend-weighted blend of each item's deposit percentage. Weighting by line
// value means a $120 room at 25% and a $60 room at 50% average out fairly, and
// the blended rate is always 0-100 so the deposit never exceeds the total.
function blendedDepositPercent(items: CartItem[]): number {
  const base = items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  if (base === 0) return 0;
  const weighted = items.reduce(
    (sum, i) => sum + i.priceCents * i.quantity * (i.depositPercent ?? DEFAULT_DEPOSIT_PERCENT),
    0
  );
  return weighted / base;
}

// percentOff comes from a validated promo code (0 when none applied).
// taxPercent is the combined active tax rate (e.g. 5 for 5%). Both promo codes
// and taxes live in the database; the server revalidates at booking time.
export function computeTotals(items: CartItem[], percentOff: number, taxPercent: number): Totals {
  const subtotalCents = items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  const discountCents = Math.round((subtotalCents * percentOff) / 100);
  const taxableCents = subtotalCents - discountCents;
  const gstCents = Math.round((taxableCents * taxPercent) / 100);
  const totalCents = taxableCents + gstCents;
  const depositCents = Math.round((totalCents * blendedDepositPercent(items)) / 100);
  return { subtotalCents, discountCents, gstCents, totalCents, depositCents };
}

export function amountDueCents(totals: Totals, option: PaymentOption): number {
  return option === "deposit" ? totals.depositCents : totals.totalCents;
}
