import type { CartItem, PaymentOption } from "./types";

export const HOLD_MINUTES = 15;
export const BOOKING_WINDOW_DAYS = 60;
export const MIN_PARTY_SIZE = 3; // default smallest group for a new experience
export const DEFAULT_TAX_PERCENT = 5; // fallback if the tax config can't be read
export const DEFAULT_DEPOSIT_PERCENT = 25; // fallback for items saved before deposits were configurable

// How the listed price relates to tax, and what a deposit costs. Both live in
// Settings → Taxes & fees; these are the fallbacks when nothing is saved.
export type PricingMode = {
  // true  → the listed price INCLUDES tax ($30 on the site means $30 charged,
  //         with the tax portion shown as a breakdown).
  // false → tax is added on top at checkout ($30 becomes $31.50).
  taxInclusive: boolean;
  // When set, every booking takes this flat deposit instead of a percentage.
  depositFlatCents: number | null;
};

export const DEFAULT_PRICING_MODE: PricingMode = { taxInclusive: false, depositFlatCents: null };

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
//
// Tax-inclusive mode works backwards from the listed price: the money charged
// is exactly price x guests, and the tax is EXTRACTED from it. That keeps the
// total on a round number for every group size, which repeatedly rounding a
// tax-exclusive price cannot do (4 x $28.57 + 5% lands on $119.99, not $120).
export function computeTotals(
  items: CartItem[],
  percentOff: number,
  taxPercent: number,
  mode: PricingMode = DEFAULT_PRICING_MODE
): Totals {
  const listedCents = items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  const discountCents = Math.round((listedCents * percentOff) / 100);

  let subtotalCents: number;
  let gstCents: number;
  let totalCents: number;
  if (mode.taxInclusive) {
    totalCents = listedCents - discountCents; // what the customer actually pays
    subtotalCents = Math.round(totalCents / (1 + taxPercent / 100)); // pre-tax portion
    gstCents = totalCents - subtotalCents; // the rest is tax, so it always reconciles
  } else {
    subtotalCents = listedCents - discountCents;
    gstCents = Math.round((subtotalCents * taxPercent) / 100);
    totalCents = subtotalCents + gstCents;
  }

  // A flat deposit never exceeds what's owed (a small booking pays its total).
  const depositCents =
    mode.depositFlatCents != null
      ? Math.min(mode.depositFlatCents, totalCents)
      : Math.round((totalCents * blendedDepositPercent(items)) / 100);
  return { subtotalCents, discountCents, gstCents, totalCents, depositCents };
}

export function amountDueCents(totals: Totals, option: PaymentOption): number {
  return option === "deposit" ? totals.depositCents : totals.totalCents;
}
