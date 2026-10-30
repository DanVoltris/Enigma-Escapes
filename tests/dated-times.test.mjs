// "Different times for some dates" (lib/schedule.ts, lib/time-periods.ts,
// migrations/0017 and 0018): for one day or a stretch, a room runs a different
// list of start times, then goes back to its usual ones. `npm run test:schedule`.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { startTimesFor } from "../lib/schedule.ts";
import { periodsProblem, withDay } from "../lib/time-periods.ts";
import { applyMigration, buildDatabase, read } from "./pg-harness.mjs";

const holidays = { from: "2026-12-20", to: "2027-01-03", times: ["12:00", "14:00"] };
const room = {
  scheduleMode: "times",
  times: ["10:00", "12:00", "14:00", "16:00", "18:00"],
  windows: {},
  intervalMinutes: 75,
  durationMinutes: 60,
  dateTimes: {},
  availableFrom: null,
  availableTo: null,
  timePeriods: [holidays],
};

test("the usual times outside the stretch", () => {
  assert.deepEqual(startTimesFor(room, "2026-12-19"), room.times);
  assert.deepEqual(startTimesFor(room, "2027-01-04"), room.times);
});

test("the different times on both ends of the stretch and between", () => {
  for (const d of ["2026-12-20", "2026-12-31", "2027-01-03"]) {
    assert.deepEqual(startTimesFor(room, d), ["12:00", "14:00"]);
  }
});

test("one day inside a stretch wins on that day only", () => {
  const eve = { ...room, timePeriods: withDay(room.timePeriods, "2026-12-24", ["11:00"]) };
  assert.deepEqual(startTimesFor(eve, "2026-12-24"), ["11:00"]);
  assert.deepEqual(startTimesFor(eve, "2026-12-23"), ["12:00", "14:00"]);
  // Clearing the day puts it back on the stretch, not on the usual times.
  const cleared = { ...eve, timePeriods: withDay(eve.timePeriods, "2026-12-24", null) };
  assert.deepEqual(startTimesFor(cleared, "2026-12-24"), ["12:00", "14:00"]);
});

test("an older day list still counts until it's moved", () => {
  const legacy = { ...room, dateTimes: { "2026-12-24": ["11:00"] } };
  assert.deepEqual(startTimesFor(legacy, "2026-12-24"), ["11:00"]);
});

test("a room out of season runs nothing, whatever the dates say", () => {
  assert.deepEqual(startTimesFor({ ...room, availableTo: "2026-12-25" }, "2026-12-28"), []);
});

test("stretches may nest or stay apart, but not cross", () => {
  const day = { from: "2026-12-24", to: "2026-12-24", times: ["11:00"] };
  assert.equal(periodsProblem([holidays, day]), null);
  assert.equal(periodsProblem([holidays, { from: "2027-02-01", to: "2027-02-14", times: ["10:00"] }]), null);
  assert.match(periodsProblem([holidays, { from: "2027-01-01", to: "2027-01-10", times: ["10:00"] }]), /overlap/);
  assert.match(periodsProblem([holidays, { ...holidays }]), /twice/);
});

describe("migration 0018 moves each day's list into the dated times", () => {
  let db;
  before(async () => {
    db = await buildDatabase({ through: "0017" });
    const tenant = (await db.query("select id from tenants limit 1")).rows[0].id;
    await db.query(
      `insert into experiences (id, name, tenant_id, date_times, time_periods) values
         ('a', 'Day lists only', $1, '{"2026-11-05": ["11:00", "13:00"], "2026-11-06": []}', null),
         ('b', 'Both', $1, '{"2026-12-24": ["11:00"]}', '[{"from": "2026-12-20", "to": "2027-01-03", "times": ["12:00"]}]'),
         ('c', 'Neither', $1, null, null)`,
      [tenant]
    );
    await applyMigration(db, "0018_day-times-into-periods.sql");
  });
  const row = async (id) => (await db.query("select date_times, time_periods from experiences where id = $1", [id])).rows[0];

  test("a day's list becomes a one-day entry; an empty one is dropped", async () => {
    const a = await row("a");
    assert.deepEqual(a.date_times, {});
    assert.deepEqual(a.time_periods, [{ from: "2026-11-05", to: "2026-11-05", times: ["11:00", "13:00"] }]);
  });

  test("it joins a room's existing stretches", async () => {
    const b = await row("b");
    assert.deepEqual(b.time_periods, [
      { from: "2026-12-20", to: "2027-01-03", times: ["12:00"] },
      { from: "2026-12-24", to: "2026-12-24", times: ["11:00"] },
    ]);
  });

  test("a room with neither is untouched", async () => {
    const c = await row("c");
    assert.equal(c.date_times, null);
    assert.equal(c.time_periods, null);
  });

  test("the undo puts the day back", async () => {
    await db.exec(read("migrations/rollback/0018_day-times-into-periods.down.sql"));
    const b = await row("b");
    assert.deepEqual(b.date_times, { "2026-12-24": ["11:00"] });
    assert.deepEqual(b.time_periods, [{ from: "2026-12-20", to: "2027-01-03", times: ["12:00"] }]);
  });
});
