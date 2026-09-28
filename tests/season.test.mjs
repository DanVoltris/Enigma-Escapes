// When a seasonal room runs (lib/season.ts). Pure rules, no database: run with
// `npm run test:season`. This is what keeps a Christmas room off the booking
// site in July — lib/schedule.ts asks it before it offers any start time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inSeason } from "../lib/season.ts";

// Enigma's St. Vital rooms: noon to 9pm Mon-Sat, last game 6pm on Sunday.
const WEEK = ["12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00"];
const SUNDAY = ["12:00", "13:30", "15:00", "16:30", "18:00"];
const windows = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const times = d === 0 ? SUNDAY : WEEK;
    return [String(d), { first: times[0], last: times[times.length - 1], times, closed: false }];
  })
);
const room = (over = {}) => ({
  id: "reindeer-games",
  name: "Reindeer Games",
  scheduleMode: "window",
  times: [],
  intervalMinutes: 90,
  windows,
  dateTimes: {},
  durationMinutes: 60,
  availableFrom: null,
  availableTo: null,
  ...over,
});

// 2026-12-05 is a Saturday, 2026-12-06 a Sunday.
test("a room with no season runs whenever it is switched on", () => {
  assert.equal(inSeason(room(), "2026-07-04"), true);
});

test("a seasonal room runs inside its dates, including both ends", () => {
  const xmas = room({ availableFrom: "2026-11-14", availableTo: "2027-01-04" });
  assert.equal(inSeason(xmas, "2026-11-14"), true); // first day
  assert.equal(inSeason(xmas, "2026-12-25"), true);
  assert.equal(inSeason(xmas, "2027-01-04"), true); // last day
});

test("outside its dates it offers nothing at all", () => {
  const xmas = room({ availableFrom: "2026-11-14", availableTo: "2027-01-04" });
  assert.equal(inSeason(xmas, "2026-11-13"), false); // the day before
  assert.equal(inSeason(xmas, "2027-01-05"), false); // the day after
});

test("one open end: a room that opens on a date, or closes after one", () => {
  const opens = room({ availableFrom: "2026-11-14", availableTo: null });
  assert.equal(inSeason(opens, "2026-11-13"), false);
  assert.equal(inSeason(opens, "2030-05-01"), true);
  const closes = room({ availableFrom: null, availableTo: "2027-01-04" });
  assert.equal(closes.availableFrom, null);
  assert.equal(inSeason(closes, "2020-01-01"), true);
  assert.equal(inSeason(closes, "2027-01-05"), false);
});
