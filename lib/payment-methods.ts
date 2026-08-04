// Payment methods offered at the desk. Pure module — the client payment
// builder and the server route both read from here so they can't drift.
import type { PaymentMethod } from "./types";

export const PAYMENT_METHODS: PaymentMethod[] = [
  "card",
  "debit",
  "cash",
  "etransfer",
  "giftcard",
  "cheque",
  "other",
];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: "Card (terminal)",
  debit: "Debit (terminal)",
  cash: "Cash",
  etransfer: "E-transfer",
  giftcard: "Gift card",
  cheque: "Cheque",
  other: "Other",
};

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && (PAYMENT_METHODS as string[]).includes(v);
}

// Splits an amount n ways in whole cents, giving the remainder to the first
// shares so the parts always add back up to the total exactly.
export function splitEvenly(totalCents: number, ways: number): number[] {
  if (ways < 1) return [];
  const base = Math.floor(totalCents / ways);
  const remainder = totalCents - base * ways;
  return Array.from({ length: ways }, (_, i) => base + (i < remainder ? 1 : 0));
}
