// What the gift-voucher shop sells — pure constants, safe for the browser
// bundle (lib/voucher-shop.ts holds the server-only minting logic).

export type VoucherProduct = { cents: number; name: string };

// The full product list carried over from the old system, sorted low to high
// so customers can scan it. Two entries from that dropdown are deliberately
// absent: "Gift voucher for $130" and a second "$120" were both priced at
// $0.01 there — selling a $130 voucher for a penny is a data error, not an
// offer, so they're left out rather than copied across.
export const VOUCHER_PRODUCTS: VoucherProduct[] = [
  { cents: 2800, name: "Gift Voucher for $28" },
  { cents: 3000, name: "Gift Voucher for $30" },
  { cents: 3750, name: "Gift Voucher for $37.50" },
  { cents: 5600, name: "Gift Voucher for $56" },
  { cents: 6000, name: "Gift Voucher for $60" },
  { cents: 8000, name: "Virtual Escape Voucher $80" },
  { cents: 8400, name: "Gift Voucher for $84" },
  { cents: 9000, name: "Gift Voucher for $90" },
  { cents: 11200, name: "Gift Voucher for $112" },
  { cents: 12000, name: "Gift Voucher for $120" },
  { cents: 14000, name: "Gift Voucher for $140" },
  { cents: 15000, name: "Gift Voucher for $150" },
  { cents: 16800, name: "Gift Voucher for $168" },
  { cents: 18000, name: "Gift Voucher for $180" },
  { cents: 19600, name: "Gift Voucher for $196" },
  { cents: 21000, name: "Gift Voucher for $210" },
  { cents: 22400, name: "Gift Voucher for $224" },
  { cents: 24000, name: "Gift Voucher for $240" },
  { cents: 30000, name: "Gift Voucher for $300" },
  { cents: 39000, name: "Gift Voucher for $390" },
];

export const DENOMINATIONS_CENTS = VOUCHER_PRODUCTS.map((p) => p.cents);

// Matches how the old system labelled each option in its dropdown.
export function voucherLabel(p: VoucherProduct): string {
  return `${p.name} ( $${(p.cents / 100).toFixed(2)} )`;
}

// Only the listed products can be bought — no custom amounts, so a
// hand-crafted request can't mint anything that isn't on sale.
export function isSellableAmount(cents: number): boolean {
  return Number.isInteger(cents) && DENOMINATIONS_CENTS.includes(cents);
}
