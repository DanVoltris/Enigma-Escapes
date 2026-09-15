// Who gets which phone notification (lib/push-events.ts). Pure rules, no
// database: run with `npm run test:push`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deviceLabel,
  eventsFor,
  needsNudge,
  normalizePrefs,
  PUSH_EVENTS,
  pushEndpointProblem,
  wantsAlert,
} from "../lib/push-events.ts";

const ALL = ["calendar", "bookings.view", "bookings.create", "bookings.modify", "requests"];
const person = (over = {}) => ({ id: "a", role: "manager", locations: [], permissions: ALL, active: true, ...over });
const alert = (over = {}) => ({ event: "request.new", locations: ["Grant Park"], ...over });

test("defaults: action alerts on, the all-day ones off", () => {
  const p = normalizePrefs(null);
  assert.equal(p["request.new"], true);
  assert.equal(p["request.confirmed"], true);
  assert.equal(p["request.released"], true);
  assert.equal(p["booking.cancelled"], true);
  assert.equal(p["booking.rescheduled"], true);
  assert.equal(p["booking.new"], false);
  assert.equal(p["booking.walkin"], false);
});

test("stored choices win, junk is ignored, missing keys take the default", () => {
  const p = normalizePrefs({ "request.new": false, "booking.new": true, "made.up": true, "booking.walkin": "yes" });
  assert.equal(p["request.new"], false);
  assert.equal(p["booking.new"], true);
  assert.equal(p["booking.walkin"], false);
  assert.equal("made.up" in p, false);
  assert.deepEqual(Object.keys(normalizePrefs([1, 2])).sort(), [...PUSH_EVENTS].sort());
});

test("a person switched on, covering the location, gets it", () => {
  assert.equal(wantsAlert(person(), normalizePrefs(null), alert()), true);
});

test("switched off, disabled, or the one who did it: no alert", () => {
  assert.equal(wantsAlert(person(), normalizePrefs({ "request.new": false }), alert()), false);
  assert.equal(wantsAlert(person({ active: false }), normalizePrefs(null), alert()), false);
  assert.equal(wantsAlert(person(), normalizePrefs(null), alert({ exceptStaffId: "a" })), false);
});

test("no permission for what it's about: no alert, whatever the switch says", () => {
  const noRequests = person({ permissions: ["calendar", "bookings.view"] });
  assert.equal(wantsAlert(noRequests, normalizePrefs({ "request.new": true }), alert()), false);
  assert.deepEqual(eventsFor(noRequests), ["booking.cancelled", "booking.rescheduled", "booking.new", "booking.walkin"]);
});

test("locations: scoped managers only hear about their own; admins and unscoped hear everything", () => {
  const prefs = normalizePrefs(null);
  assert.equal(wantsAlert(person({ locations: ["St. Vital"] }), prefs, alert()), false);
  assert.equal(wantsAlert(person({ locations: ["St. Vital", "Grant Park"] }), prefs, alert()), true);
  assert.equal(wantsAlert(person({ role: "admin", locations: ["St. Vital"] }), prefs, alert()), true);
  assert.equal(wantsAlert(person({ locations: [] }), prefs, alert()), true);
  // A booking spanning two locations reaches either location's manager.
  assert.equal(
    wantsAlert(person({ locations: ["St. Vital"] }), prefs, alert({ event: "booking.cancelled", locations: ["Grant Park", "St. Vital"] })),
    true
  );
});

test("only real push services are accepted as a phone's address", () => {
  assert.equal(pushEndpointProblem("https://web.push.apple.com/QGx"), null);
  assert.equal(pushEndpointProblem("https://fcm.googleapis.com/fcm/send/abc"), null);
  assert.equal(pushEndpointProblem("https://updates.push.services.mozilla.com/wpush/v2/x"), null);
  assert.notEqual(pushEndpointProblem("http://fcm.googleapis.com/fcm/send/abc"), null);
  assert.notEqual(pushEndpointProblem("https://169.254.169.254/latest"), null);
  assert.notEqual(pushEndpointProblem("https://fcm.googleapis.com.evil.example/x"), null);
  assert.notEqual(pushEndpointProblem("https://evilpush.apple.com/x"), null);
  assert.notEqual(pushEndpointProblem(42), null);
});

test("device names a person recognises", () => {
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit"), "iPhone");
  assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari"), "Android phone");
  assert.equal(deviceLabel(null), "Unknown device");
});

test("the two-week reminder: once per quiet spell, re-armed by opening the app", () => {
  const day = 86_400_000;
  const now = Date.parse("2026-09-30T12:00:00Z");
  const iso = (ms) => new Date(ms).toISOString();
  const quiet = { last_seen_at: iso(now - 15 * day), nudged_at: null, stopped_at: null };
  assert.equal(needsNudge(quiet, now), true);
  assert.equal(needsNudge({ ...quiet, last_seen_at: iso(now - 13 * day) }, now), false);
  assert.equal(needsNudge({ ...quiet, nudged_at: iso(now - 1 * day) }, now), false); // already told
  assert.equal(needsNudge({ ...quiet, nudged_at: iso(now - 20 * day) }, now), true); // told last time, opened since, quiet again
  assert.equal(needsNudge({ ...quiet, stopped_at: iso(now) }, now), false); // can't reach it anyway
});
