// Shop-side voucher types — pure, safe for the browser bundle. The catalogue
// itself lives in the voucher_products table and is managed on the Gift
// vouchers tab; this just describes the shape and how each option is labelled.

export type ShopProduct = { cents: number; name: string };

// Matches how the old system labelled each option in its dropdown.
export function voucherLabel(p: ShopProduct): string {
  return `${p.name} ( $${(p.cents / 100).toFixed(2)} )`;
}
