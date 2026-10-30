// Repeating blocks (lib/blocks.ts, migrations/0016): which sessions a rule takes
// out of service on a given date. Pure rules, no database: `npm run test:blocks`.
//
// The case this exists for: a manager closing weekday mornings "for the
// foreseeable future" by texting the owner, who blocked them a date at a time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleCovers, ruleKeysForDate, ruleKeysForDays } from "../lib/blocks.ts";

// 2026-11-02 is a Monday.
const mornings = {
  id: "r1",
  roomId: "shady-grove",
  weekdays: [1, 2],
  times: ["10:00", "11:30"],
  from: "2026-11-02",
  until: null,
  reason: "Short-staffed",
  blockedBy: "Manager",
  createdAt: "2026-10-30T00:00:00Z",
};

test("covers its weekdays from the start date on, with no end", () => {
  assert.equal(ruleCovers(mornings, "2026-11-02"), true); // Monday, first day
  assert.equal(ruleCovers(mornings, "2026-11-03"), true); // Tuesday
  assert.equal(ruleCovers(mornings, "2026-11-04"), false); // Wednesday
  assert.equal(ruleCovers(mornings, "2027-06-07"), true); // a Monday months later
  assert.equal(ruleCovers(mornings, "2026-10-26"), false); // a Monday before it starts
});

test("stops after its end date, inclusive", () => {
  const toEnd = { ...mornings, until: "2026-11-09" };
  assert.equal(ruleCovers(toEnd, "2026-11-09"), true);
  assert.equal(ruleCovers(toEnd, "2026-11-16"), false);
});

test("keys are the room's times on covered dates only", () => {
  assert.deepEqual(ruleKeysForDate([mornings], "2026-11-02"), ["shady-grove|10:00", "shady-grove|11:30"]);
  assert.deepEqual(ruleKeysForDate([mornings], "2026-11-04"), []);
  assert.deepEqual(ruleKeysForDays([mornings], ["2026-11-02", "2026-11-04"]), [
    "shady-grove|2026-11-02|10:00",
    "shady-grove|2026-11-02|11:30",
  ]);
});
