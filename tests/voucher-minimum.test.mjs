// What a gift voucher may be worth (lib/voucher-minimum.ts). Pure arithmetic,
// no database: run with `npm run test:voucher`.
//
// The owner's rule: the smallest voucher is what one person pays to play,
// rounded DOWN to a round five dollars.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  floorToFiveDollars,
  onePersonCents,
  voucherMinimumCents,
  voucherShortfallNote,
  VOUCHER_FLOOR_CENTS,
  VOUCHER_MAX_CENTS,
} from "../lib/voucher-minimum.ts";

test("one person's price picks up the venue's tax", () => {
  // Enigma: $28.58 a head plus 5% GST.
  assert.equal(onePersonCents(2858, 5, false), 3001);
  // Time Zone: $29.99 plus 13% HST — the figure the owner quoted.
  assert.equal(onePersonCents(2999, 13, false), 3389);
  // A venue quoting tax-inclusive prices is already there.
  assert.equal(onePersonCents(3000, 13, true), 3000);
});

test("the minimum rounds down to a round five dollars", () => {
  assert.equal(voucherMinimumCents(3001), 3000); // Enigma
  assert.equal(voucherMinimumCents(3389), 3000); // Time Zone
  assert.equal(voucherMinimumCents(3500), 3500); // exactly on a five stays
  assert.equal(voucherMinimumCents(3499), 3000);
  assert.equal(voucherMinimumCents(9900), 9500);
  assert.equal(floorToFiveDollars(3389), 3000);
});

test("it never rounds down to nothing", () => {
  assert.equal(voucherMinimumCents(400), VOUCHER_FLOOR_CENTS);
  assert.equal(voucherMinimumCents(0), VOUCHER_FLOOR_CENTS);
  assert.equal(voucherMinimumCents(NaN), VOUCHER_FLOOR_CENTS);
  assert.ok(VOUCHER_MAX_CENTS > VOUCHER_FLOOR_CENTS);
});

test("the buyer is told when the voucher won't cover a whole game", () => {
  // Enigma bills a minimum of three, so the smallest booking is $90.03.
  const note = voucherShortfallNote(3000, 9003, 3);
  assert.match(note, /\$90\.03/);
  assert.match(note, /minimum of 3 players/);
  // A venue with no minimum charge talks about one person instead.
  assert.match(voucherShortfallNote(3000, 3389, 1), /A game for one person is \$33\.89/);
  // Enough to cover it: nothing to say.
  assert.equal(voucherShortfallNote(9100, 9003, 3), null);
  assert.equal(voucherShortfallNote(9003, 9003, 3), null);
});
