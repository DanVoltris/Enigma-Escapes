// The rules for lib/db-cache.ts — which reads are remembered and which writes
// clear them. Kept apart from Next's cache functions so they can be tested on
// their own (tests/db-cache.test.mjs).

// Read on nearly every render, changed rarely, and only ever written by rest().
const CACHED_TABLES = new Set(["experiences", "location_hours", "taxes", "slot_block_rules"]);

// Display and configuration settings only. Never a key used as a lock or a
// timer: the sign-in throttle compares-and-swaps its row, and the sweep, push
// nudge and event pruning keys space out background work — a stale read of any
// of those would let it run when it shouldn't.
const CACHED_SETTINGS = new Set([
  "locale",
  "business_details",
  "booking_site",
  "integrations",
  "booking_policies",
  "pricing_mode",
  "rewards",
]);

// Writes to these change what /api/availability would answer.
const AVAILABILITY_TABLES = new Set([
  "bookings",
  "booking_requests",
  "slot_blocks",
  "slot_block_rules",
  "experiences",
  "location_hours",
]);

export const AVAILABILITY_TAG = "availability";

const tableOf = (path: string) => path.split(/[?/]/)[0];

// The exact shape getSetting() asks with — anything else on settings (the
// throttle reads updated_at too) goes to the database.
function settingKeyRead(path: string): string | null {
  const m = path.match(/^settings\?key=eq\.([^&]+)&select=value&limit=1$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Tags for a GET worth caching, or null to read live. */
export function readTags(path: string): string[] | null {
  const table = tableOf(path);
  if (CACHED_TABLES.has(table)) return [`db:${table}`];
  if (table === "settings") {
    const key = settingKeyRead(path);
    if (key && CACHED_SETTINGS.has(key)) return [`db:settings:${key}`];
  }
  return null;
}

/** Tags a write to `path` makes stale. */
export function writeTags(path: string, body: BodyInit | null | undefined): string[] {
  const table = tableOf(path);
  const tags: string[] = [];
  if (CACHED_TABLES.has(table)) tags.push(`db:${table}`);
  if (table === "settings") {
    const keys = settingKeysWritten(path, body);
    const hit = keys ? keys.filter((k) => CACHED_SETTINGS.has(k)) : [...CACHED_SETTINGS];
    tags.push(...hit.map((k) => `db:settings:${k}`));
    // booking_site carries the request window and booking horizon.
    if (hit.length > 0) tags.push(AVAILABILITY_TAG);
  }
  if (AVAILABILITY_TABLES.has(table)) tags.push(AVAILABILITY_TAG);
  return [...new Set(tags)];
}

// Which keys a settings write touches: from the body (upserts) or the filter
// (patches and deletes). Null when it can't tell, which clears every one.
function settingKeysWritten(path: string, body: BodyInit | null | undefined): string[] | null {
  const m = path.match(/[?&]key=eq\.([^&]+)/);
  if (m) return [decodeURIComponent(m[1])];
  if (typeof body !== "string") return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const keys = rows.map((r) => (r && typeof r === "object" ? (r as { key?: unknown }).key : undefined));
    return keys.every((k): k is string => typeof k === "string") ? keys : null;
  } catch {
    return null;
  }
}
