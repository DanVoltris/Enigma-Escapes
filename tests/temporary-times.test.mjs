// Temporary times (lib/schedule.ts, migrations/0017): between two dates a room
// runs a different list of start times, then goes back to its usual ones.
// Pure rules, no database: `npm run test:schedule`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTimesFor } from "../lib/schedule.ts";

const room = {
  scheduleMode: "times",
  times: ["10:00", "12:00", "14:00", "16:00", "18:00"],
  windows: {},
  intervalMinutes: 75,
  durationMinutes: 60,
  dateTimes: {},
  availableFrom: null,
  availableTo: null,
  timePeriods: [{ from: "2026-12-20", to: "2027-01-03", times: ["12:00", "14:00"] }],
};

test("the usual times outside the period", () => {
  assert.deepEqual(startTimesFor(room, "2026-12-19"), room.times);
  assert.deepEqual(startTimesFor(room, "2027-01-04"), room.times);
});

test("the temporary times on both ends of the period and between", () => {
  for (const d of ["2026-12-20", "2026-12-31", "2027-01-03"]) {
    assert.deepEqual(startTimesFor(room, d), ["12:00", "14:00"]);
  }
});

test("a date's own list still beats the period", () => {
  const withDay = { ...room, dateTimes: { "2026-12-24": ["11:00"] } };
  assert.deepEqual(startTimesFor(withDay, "2026-12-24"), ["11:00"]);
});

test("a room out of season runs nothing, whatever the period says", () => {
  const seasonal = { ...room, availableTo: "2026-12-25" };
  assert.deepEqual(startTimesFor(seasonal, "2026-12-28"), []);
});
