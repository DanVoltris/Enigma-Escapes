// What a booking costs (lib/pricing.ts). Pure maths, no database: run with
// `npm run test:pricing`. Figures here are Enigma's: $28.58 a head, 5% GST, and
// a room run for two but charged as three.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chargedGuests, computeTotals, lineCents, DEFAULT_PRICING_MODE } from "../lib/pricing.ts";

const PRICE = 2858;
const room = (quantity, over = {}) => ({
  roomId: "alice",
  roomName: "Alice in Wonderland",
  location: "Keenleyside",
  date: "2026-10-02",
  time: "19:00",
  quantity,
  priceCents: PRICE,
  durationMinutes: 60,
  depositPercent: 25,
  badgeBg: "#000",
  badgeFg: "#fff",
  ...over,
});
const withMinimum = { ...DEFAULT_PRICING_MODE, minChargedGuests: 3 };
const totals = (items, mode = DEFAULT_PRICING_MODE) => computeTotals(items, 0, 5, mode);

test("no minimum set: a pair pays for two", () => {
  assert.equal(chargedGuests(room(2)), 2);
  assert.equal(lineCents(room(2)), 5716);
  assert.equal(totals([room(2)]).totalCents, 6002); // $60.02
});

test("with a minimum of three, a pair pays for three", () => {
  assert.equal(chargedGuests(room(2), withMinimum), 3);
  assert.equal(lineCents(room(2), withMinimum), 8574);
  const t = totals([room(2)], withMinimum);
  assert.equal(t.subtotalCents, 8574);
  assert.equal(t.gstCents, 429);
  assert.equal(t.totalCents, 9003); // $90.03, the same as three guests
  assert.equal(t.totalCents, totals([room(3)], withMinimum).totalCents);
});

test("one person pays the minimum too, and bigger parties are untouched", () => {
  assert.equal(totals([room(1)], withMinimum).totalCents, 9003);
  assert.equal(totals([room(4)], withMinimum).totalCents, totals([room(4)]).totalCents);
  assert.equal(chargedGuests(room(8), withMinimum), 8);
});

test("the minimum applies per room, so two rooms of two are charged as three each", () => {
  const t = totals([room(2), room(2, { roomId: "genie", time: "20:30" })], withMinimum);
  assert.equal(t.subtotalCents, 8574 * 2);
  // Tax is struck once on the whole subtotal, so this is a cent under twice a
  // single room's $90.03 — rounding once, not per line.
  assert.equal(t.totalCents, 18005); // $180.05
});

test("what a booking was charged for is remembered, whatever the rule says later", () => {
  // Taken while the minimum was three; the rule is off today.
  const taken = room(2, { chargedQuantity: 3 });
  assert.equal(lineCents(taken), 8574);
  assert.equal(totals([taken]).totalCents, 9003);
  // A higher minimum today wins over a smaller stored charge.
  assert.equal(chargedGuests(taken, { ...DEFAULT_PRICING_MODE, minChargedGuests: 4 }), 4);
});

test("the deposit follows the charged amount, not the heads in the room", () => {
  assert.equal(totals([room(2)], withMinimum).depositCents, Math.round(9003 * 0.25));
  const flat = { ...withMinimum, depositFlatCents: 3000 };
  assert.equal(totals([room(2)], flat).depositCents, 3000);
});

test("a promo still comes off, and tax-inclusive pricing lands on the round number", () => {
  const halfOff = computeTotals([room(2)], 50, 5, withMinimum);
  assert.equal(halfOff.discountCents, 4287);
  assert.equal(halfOff.subtotalCents, 8574 - 4287);
  const inclusive = computeTotals([room(2, { priceCents: 3000 })], 0, 5, {
    ...withMinimum,
    taxInclusive: true,
  });
  assert.equal(inclusive.totalCents, 9000); // exactly $90 for the pair
});
