import type { CartItem, PaymentOption } from "./types";

export const GST_RATE = 0.05;
export const DEPOSIT_RATE = 0.25;
export const HOLD_MINUTES = 15;
export const BOOKING_WINDOW_DAYS = 60;

// Shared by client (instant feedback) and server (authoritative recalculation).
export const PROMO_CODES: Record<string, number> = {
  WELCOME10: 0.1,
};

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  gstCents: number;
  totalCents: number;
  depositCents: number;
};

export function computeTotals(items: CartItem[], promoCode: string | null): Totals {
  const subtotalCents = items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  const rate = promoCode ? PROMO_CODES[promoCode] ?? 0 : 0;
  const discountCents = Math.round(subtotalCents * rate);
  const taxableCents = subtotalCents - discountCents;
  const gstCents = Math.round(taxableCents * GST_RATE);
  const totalCents = taxableCents + gstCents;
  const depositCents = Math.round(totalCents * DEPOSIT_RATE);
  return { subtotalCents, discountCents, gstCents, totalCents, depositCents };
}

export function amountDueCents(totals: Totals, option: PaymentOption): number {
  return option === "deposit" ? totals.depositCents : totals.totalCents;
}
