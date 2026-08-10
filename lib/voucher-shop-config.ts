// What the gift-voucher shop sells — pure constants, safe for the browser
// bundle (lib/voucher-shop.ts holds the server-only minting logic).

// Mirrors the old system's "Select gift voucher" list: multiples of the $28
// per-guest rate, one to seven guests. Edit this list to change the offer.
export const DENOMINATIONS_CENTS = [2800, 5600, 8400, 11200, 14000, 16800, 19600];

export function voucherLabel(cents: number): string {
  const d = cents / 100;
  return `Gift Voucher for $${d} ( $${d.toFixed(2)} )`;
}

// Only the listed products can be bought — no custom amounts, matching the
// old system, and a hand-crafted request can't mint anything else.
export function isSellableAmount(cents: number): boolean {
  return Number.isInteger(cents) && DENOMINATIONS_CENTS.includes(cents);
}
