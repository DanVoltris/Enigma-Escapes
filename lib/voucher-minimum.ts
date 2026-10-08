// The smallest gift voucher a customer may buy, and the rule behind it.
//
// Pure arithmetic, no database: the venue's own numbers are read by the page
// and the purchase route and passed in. Tested by tests/voucher-minimum.test.mjs.
//
// The rule the owner set: a voucher has to be worth at least what one person
// pays to play, rounded DOWN to a round five dollars — $30.01 a head at Enigma
// and $33.89 at Time Zone both land on $30. Rounding down rather than up keeps
// the minimum a friendly number instead of one a cent above the real price.

// Dollar amounts, in cents, that the box will take at all. The ceiling is there
// to stop a slipped keyboard ($300000) and a card-testing run, not to say what
// a generous present is.
export const VOUCHER_MAX_CENTS = 100_000; // $1,000
// Even a venue that gave its rooms away would not sell a $0 voucher.
export const VOUCHER_FLOOR_CENTS = 500; // $5

const FIVE_DOLLARS = 500;

export function floorToFiveDollars(cents: number): number {
  return Math.floor(cents / FIVE_DOLLARS) * FIVE_DOLLARS;
}

// onePersonCents is what one person pays for one game, tax included.
export function voucherMinimumCents(onePersonCents: number): number {
  if (!Number.isFinite(onePersonCents) || onePersonCents <= 0) return VOUCHER_FLOOR_CENTS;
  return Math.max(VOUCHER_FLOOR_CENTS, floorToFiveDollars(Math.round(onePersonCents)));
}

// What one person pays for one game, from the room's per-head price and the
// venue's taxes. taxInclusive venues quote the price with tax already in it.
export function onePersonCents(perHeadCents: number, taxPercent: number, taxInclusive: boolean): number {
  if (taxInclusive) return Math.round(perHeadCents);
  return Math.round(perHeadCents * (1 + taxPercent / 100));
}

// Why the minimum is not the price of a game: a voucher under what a booking
// costs is still a perfectly good present, it just won't pay for the whole
// thing, and a buyer should hear that before they buy rather than the
// recipient at the till.
export function voucherShortfallNote(
  amountCents: number,
  smallestBookingCents: number,
  minChargedGuests: number
): string | null {
  if (amountCents <= 0 || amountCents >= smallestBookingCents) return null;
  const money = `$${(smallestBookingCents / 100).toFixed(2)}`;
  return minChargedGuests > 1
    ? `Our smallest booking is ${money} — we bill a minimum of ${minChargedGuests} players — so this would go towards a game rather than cover one.`
    : `A game for one person is ${money}, so this would go towards a game rather than cover one.`;
}
