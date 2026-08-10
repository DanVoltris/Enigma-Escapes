// What the gift-voucher shop sells — pure constants, safe for the browser
// bundle (lib/voucher-shop.ts holds the server-only minting logic).

// Drawn from what the business has actually sold historically — one room
// ($30) up to a big group ($300). Edit this list to change the offer.
export const DENOMINATIONS_CENTS = [3000, 6000, 9000, 12000, 15000, 30000];

// Anything outside this can't be bought, even with a hand-crafted request.
export const MIN_CUSTOM_CENTS = 2500;
export const MAX_CUSTOM_CENTS = 50000;

export function isSellableAmount(cents: number): boolean {
  if (!Number.isInteger(cents)) return false;
  if (DENOMINATIONS_CENTS.includes(cents)) return true;
  return cents >= MIN_CUSTOM_CENTS && cents <= MAX_CUSTOM_CENTS;
}
