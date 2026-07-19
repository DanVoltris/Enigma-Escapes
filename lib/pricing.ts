import type { CartItem, PaymentOption } from "./types";

export const GST_RATE = 0.05;
export const DEPOSIT_RATE = 0.25;
export const HOLD_MINUTES = 15;
export const BOOKING_WINDOW_DAYS = 60;
export const MIN_PARTY_SIZE = 4; // smallest group a single slot can be booked for

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  gstCents: number;
  totalCents: number;
  depositCents: number;
};

// percentOff comes from a validated promo code (0 when none applied). Promo
// codes themselves live in the database; the server revalidates at booking time.
export function computeTotals(items: CartItem[], percentOff: number): Totals {
  const subtotalCents = items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  const discountCents = Math.round((subtotalCents * percentOff) / 100);
  const taxableCents = subtotalCents - discountCents;
  const gstCents = Math.round(taxableCents * GST_RATE);
  const totalCents = taxableCents + gstCents;
  const depositCents = Math.round(totalCents * DEPOSIT_RATE);
  return { subtotalCents, discountCents, gstCents, totalCents, depositCents };
}

export function amountDueCents(totals: Totals, option: PaymentOption): number {
  return option === "deposit" ? totals.depositCents : totals.totalCents;
}
