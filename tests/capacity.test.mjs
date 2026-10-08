// How many people a room will take, and how far the desk may go over it
// (lib/capacity.ts). Pure rules, no database: run with `npm run test:capacity`.
//
// The case this exists for: eleven people turned up for Alice in Wonderland,
// a room sold for ten. Before this, the only way to take the booking was to
// edit the room's capacity and remember to put it back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { maxPerBooking, minPerBooking, remainingSpots, STAFF_OVER_LIMIT } from "../lib/capacity.ts";

const alice = { capacity: 10, maxParty: 10, minParty: 3, isPrivate: true };
const shared = { capacity: 12, maxParty: 8, minParty: 2, isPrivate: false };

test("the website is held to what the room is sold for", () => {
  assert.equal(maxPerBooking(alice), 10);
  // The smaller of the two always wins: a room for twelve sold in parties of
  // eight is a party of eight.
  assert.equal(maxPerBooking(shared), 8);
});

test("the desk may go a few over, and no further", () => {
  assert.equal(maxPerBooking(alice, true), 10 + STAFF_OVER_LIMIT);
  assert.equal(maxPerBooking(shared, true), 8 + STAFF_OVER_LIMIT);
  // The eleven that started this, and a typo that must still be refused.
  assert.ok(11 <= maxPerBooking(alice, true));
  assert.ok(110 > maxPerBooking(alice, true));
});

test("the slot check gives the same allowance, so the two agree", () => {
  // A free private room: the website sees ten seats, the desk fourteen.
  assert.equal(remainingSpots(alice, 0), 10);
  assert.equal(remainingSpots(alice, 0, true), 10 + STAFF_OVER_LIMIT);
  // Eleven must pass both gates, or the party change still fails.
  assert.ok(11 <= maxPerBooking(alice, true) && 11 <= remainingSpots(alice, 0, true));
});

test("a private room already taken stays taken, whoever is asking", () => {
  assert.equal(remainingSpots(alice, 4), 0);
  assert.equal(remainingSpots(alice, 4, true), 0);
});

test("a shared room counts the seats someone else holds", () => {
  assert.equal(remainingSpots(shared, 9), 3);
  assert.equal(remainingSpots(shared, 9, true), 3 + STAFF_OVER_LIMIT);
  assert.equal(remainingSpots(shared, 20), 0);
});

test("the minimum keeps its own staff exception", () => {
  assert.equal(minPerBooking(alice, "online"), 3);
  assert.equal(minPerBooking(alice, "in_person"), 1);
});
