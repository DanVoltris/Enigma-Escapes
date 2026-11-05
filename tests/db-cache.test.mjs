// Which reads lib/db-cache.ts remembers (lib/db-cache-rules.ts), and which writes clear them. Pure
// rules, no database: `npm run test:cache`.
//
// The two ways this could go wrong: caching something used as a lock (the
// sign-in throttle) or a timer, and a write that doesn't clear what it changed
// — a slot still showing free after it was booked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AVAILABILITY_TAG, readTags, writeTags } from "../lib/db-cache-rules.ts";

test("rooms, hours, taxes and repeating blocks are remembered", () => {
  assert.deepEqual(readTags("experiences?select=*&active=eq.true&order=sort.asc,name.asc"), ["db:experiences"]);
  assert.deepEqual(readTags("location_hours?select=*"), ["db:location_hours"]);
  assert.deepEqual(readTags("slot_block_rules?select=*&order=created_at.asc"), ["db:slot_block_rules"]);
});

test("only display settings are remembered, never locks or timers", () => {
  assert.deepEqual(readTags("settings?key=eq.booking_site&select=value&limit=1"), ["db:settings:booking_site"]);
  assert.deepEqual(readTags("settings?key=eq.locale&select=value&limit=1"), ["db:settings:locale"]);
  assert.equal(readTags("settings?key=eq.checklist_state&select=value&limit=1"), null);
  // The sign-in throttle reads updated_at for its compare-and-swap.
  assert.equal(readTags("settings?key=eq.login_throttle&select=value,updated_at&limit=1"), null);
});

test("bookings and blocks are never cached row by row", () => {
  assert.equal(readTags("bookings?select=*&items=cs.%5B%5D"), null);
  assert.equal(readTags("slot_blocks?select=room_id,time&date=eq.2026-11-07"), null);
});

test("a booking, request or block clears availability", () => {
  for (const path of ["bookings", "bookings?id=eq.x", "booking_requests?id=eq.y", "slot_blocks?on_conflict=tenant_id,room_id,date,time"]) {
    assert.ok(writeTags(path, "{}").includes(AVAILABILITY_TAG), path);
  }
});

test("a room or hours change clears both the table and availability", () => {
  assert.deepEqual(writeTags("experiences?id=eq.a", "{}").sort(), [AVAILABILITY_TAG, "db:experiences"].sort());
  assert.deepEqual(writeTags("location_hours?on_conflict=tenant_id,location", "{}").sort(), [AVAILABILITY_TAG, "db:location_hours"].sort());
});

test("a settings upsert clears exactly the key it wrote", () => {
  const body = JSON.stringify({ key: "booking_site", value: {} });
  assert.deepEqual(writeTags("settings?on_conflict=tenant_id,key", body).sort(), [AVAILABILITY_TAG, "db:settings:booking_site"].sort());
  // A timer write clears nothing cached.
  assert.deepEqual(writeTags("settings?on_conflict=tenant_id,key", JSON.stringify({ key: "request_sweep", value: "x" })), []);
});

test("a settings write it can't read clears every cached setting", () => {
  const tags = writeTags("settings?on_conflict=tenant_id,key", undefined);
  assert.ok(tags.includes("db:settings:locale") && tags.includes("db:settings:business_details"));
});
