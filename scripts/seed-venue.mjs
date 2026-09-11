// Loads a venue's rooms, taxes, hours and settings into its own database from a
// JSON file (see scripts/venues/). For standing up a new venue on its own
// Supabase project — the "one codebase, two deployments" setup.
//
//   node --env-file=.env.<venue> scripts/seed-venue.mjs scripts/venues/<venue>.json           dry run
//   node --env-file=.env.<venue> scripts/seed-venue.mjs scripts/venues/<venue>.json --apply   write
//
// Point --env-file at the NEW venue's keys, never .env.local: that one holds
// Enigma's live database. As a backstop the script refuses to write anywhere
// that already has rooms the venue file doesn't list (--force overrides, for a
// venue whose rooms were renamed).
//
// Re-runnable. Everything is an upsert on its natural key, settings are merged
// over what is stored, and a room's photo and one-off dates are never sent.
// Fields the file does set are protected too: each load records what it wrote
// (the "seed_snapshot" setting), and a later run refuses to overwrite anything
// staff have changed in the portal since — it lists each one instead. Copy the
// portal's value into the file to keep it, or pass --overwrite to replace it.
import { readFileSync } from "fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const force = args.includes("--force");
const overwrite = args.includes("--overwrite");

if (!file) {
  console.error("Usage: node --env-file=.env.<venue> scripts/seed-venue.mjs scripts/venues/<venue>.json [--apply]");
  process.exit(1);
}

// Same tolerance as lib/supabase.ts: the variable is often pasted with /rest/v1 on the end.
const BASE = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

const venue = JSON.parse(readFileSync(file, "utf8"));

// ------------------------------------------------------------------ checks
// A light mirror of lib/experience-validation.ts, so a typo in the JSON fails
// here in plain language instead of as a room the portal can't open.
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const problems = [];
for (const e of venue.experiences ?? []) {
  const at = `${e.name ?? e.id}:`;
  if (!/^[a-z0-9-]{1,60}$/.test(e.id ?? "")) problems.push(`${at} id must be lowercase-with-dashes`);
  if (!e.name || e.name.length > 80) problems.push(`${at} name is required, up to 80 characters`);
  if (!e.location || e.location.length > 80) problems.push(`${at} location is required, up to 80 characters`);
  if ((e.tagline ?? "").length > 140) problems.push(`${at} tagline is over 140 characters`);
  if (!e.description || e.description.length > 2000) problems.push(`${at} description is required, up to 2000 characters`);
  if (!(e.minParty >= 1 && e.minParty <= e.maxParty && e.maxParty <= e.capacity)) {
    problems.push(`${at} guests must satisfy 1 ≤ minParty ≤ maxParty ≤ capacity`);
  }
  if (!Number.isInteger(e.priceCents) || e.priceCents < 0 || e.priceCents > 100000) problems.push(`${at} priceCents out of range`);
  if (!HEX.test(e.badgeBg) || !HEX.test(e.badgeFg)) problems.push(`${at} badge colours must be #RRGGBB`);
  if (e.scheduleMode === "window") {
    for (const [day, w] of Object.entries(e.windows ?? {})) {
      if (w.closed) continue;
      if (!TIME.test(w.first) || !TIME.test(w.last) || w.last < w.first) problems.push(`${at} day ${day} needs HH:MM first ≤ last`);
    }
  }
}
if (problems.length) {
  console.error("The venue file has problems — nothing was done:\n  " + problems.join("\n  "));
  process.exit(1);
}

// The columns a room is written with. image_url and date_times are deliberately
// absent: a photo uploaded in the portal, or a one-off slot added for a date,
// survives a re-run.
function roomRow(e) {
  return {
    name: e.name,
    location: e.location,
    tagline: e.tagline,
    description: e.description,
    duration_minutes: e.durationMinutes,
    capacity: e.capacity,
    price_cents: e.priceCents,
    min_party: e.minParty,
    max_party: e.maxParty,
    private: e.isPrivate,
    deposit_percent: e.depositPercent,
    schedule_mode: e.scheduleMode,
    times: e.times ?? [],
    interval_minutes: e.intervalMinutes,
    windows: e.windows ?? {},
    badge_bg: e.badgeBg,
    badge_fg: e.badgeFg,
    active: e.active !== false,
    sort: e.sort ?? 0,
  };
}

// The start times a window produces — the same series lib/schedule.ts builds.
function startsFor(e, day) {
  const w = e.windows?.[day];
  if (!w || w.closed) return [];
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const out = [];
  for (let m = toMin(w.first); m <= toMin(w.last); m += Math.max(5, e.intervalMinutes)) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

// ------------------------------------------------------------------ plan
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const money = (c) => `$${(c / 100).toFixed(2)}`;
console.log(`Venue file: ${file}\n`);
for (const e of venue.experiences) {
  console.log(`${e.name}  (${e.id}) — ${e.location}`);
  console.log(`  ${money(e.priceCents)} per guest · ${e.minParty}–${e.maxParty} guests · ${e.durationMinutes} min · ${e.isPrivate ? "private" : "shared"}`);
  for (let d = 0; d < 7; d++) console.log(`  ${DAYS[d]}  ${startsFor(e, String(d)).join(" ") || "closed"}`);
}
for (const t of venue.taxes ?? []) console.log(`\nTax: ${t.name} ${t.percent}%`);
for (const h of venue.locationHours ?? []) {
  console.log(`Hours at ${h.location}: ` + DAYS.map((d, i) => `${d} ${h.hours[i].closed ? "closed" : `${h.hours[i].open}–${h.hours[i].close}`}`).join(", "));
}
for (const [key, value] of Object.entries(venue.settings ?? {})) console.log(`Setting ${key}: ${JSON.stringify(value)}`);

if (!BASE || !KEY) {
  console.log("\nDry run only — no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY loaded, so the target database wasn't checked.");
  if (apply) process.exit(1);
  process.exit(0);
}

// ------------------------------------------------------------------ target
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
async function rest(path, init = {}) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 || init.method === "POST" ? null : res.json();
}

console.log(`\nTarget database: ${new URL(BASE).host}`);
const existingRooms = await rest("experiences?select=id,name");
const ours = new Set(venue.experiences.map((e) => e.id));
const strangers = existingRooms.filter((r) => !ours.has(r.id));
console.log(`It holds ${existingRooms.length} room(s)${existingRooms.length ? ": " + existingRooms.map((r) => r.name).join(", ") : ""}.`);
if (strangers.length && !force) {
  console.error(
    `\nRefusing to write: this database has rooms the venue file doesn't list (${strangers.map((r) => r.name).join(", ")}).\n` +
      "That usually means --env-file points at another venue's database. Check the file; use --force only if you're sure."
  );
  process.exit(1);
}
const existingTaxes = await rest("taxes?select=id,name,percent,active");
const otherTaxes = existingTaxes.filter((t) => t.active && !(venue.taxes ?? []).some((v) => v.id === t.id));
if (otherTaxes.length) {
  console.log(`Warning: other active taxes stay in place and will be charged too: ${otherTaxes.map((t) => `${t.name} ${t.percent}%`).join(", ")}`);
}

// ------------------------------------------------------------------ portal edits
// Every field the file writes, by where it lives. Settings are compared one
// level deep, because that is how they are merged (a policy's title can change
// in the portal while its cutoff comes from the file).
function fieldsOf(key, value) {
  const out = {};
  for (const [f, v] of Object.entries(value)) {
    if (v && typeof v === "object" && !Array.isArray(v)) for (const [g, w] of Object.entries(v)) out[`setting ${key}: ${f}.${g}`] = w;
    else out[`setting ${key}: ${f}`] = v;
  }
  return out;
}
const planned = {};
for (const e of venue.experiences) for (const [c, v] of Object.entries(roomRow(e))) planned[`room ${e.id}: ${c}`] = v;
for (const t of venue.taxes ?? []) for (const [c, v] of Object.entries(t)) if (c !== "id") planned[`tax ${t.id}: ${c}`] = v;
for (const h of venue.locationHours ?? []) planned[`hours ${h.location}`] = h.hours;
for (const [key, value] of Object.entries(venue.settings ?? {})) Object.assign(planned, fieldsOf(key, value));

const current = {};
for (const r of await rest("experiences?select=*")) for (const c of Object.keys(roomRow(venue.experiences[0]))) current[`room ${r.id}: ${c}`] = r[c];
for (const t of await rest("taxes?select=*")) for (const [c, v] of Object.entries(t)) current[`tax ${t.id}: ${c}`] = v;
for (const h of await rest("location_hours?select=*")) current[`hours ${h.location}`] = h.hours;
const settingKeys = [...Object.keys(venue.settings ?? {}), "seed_snapshot"];
const storedSettings = Object.fromEntries(
  (await rest(`settings?select=key,value&key=in.(${settingKeys.join(",")})`)).map((s) => [s.key, s.value])
);
for (const key of Object.keys(venue.settings ?? {})) if (storedSettings[key]) Object.assign(current, fieldsOf(key, storedSettings[key]));
const snapshot = storedSettings.seed_snapshot ?? null;

// Postgres hands jsonb back with its keys reordered and numerics as numbers or
// strings depending on the column, so compare on a canonical form.
const canon = (v) =>
  JSON.stringify(v, (_, x) =>
    typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x) ? Number(x)
    : x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x
  );
const same = (a, b) => canon(a) === canon(b);
const conflicts = Object.keys(planned).filter((k) => {
  if (current[k] === undefined || current[k] === null) return false; // nothing there yet
  if (same(current[k], planned[k])) return false; // the file already agrees
  // Loaded before: a conflict only if the database has moved since. Never
  // loaded by this script: whatever is there was set by someone, so keep it.
  return snapshot && k in snapshot ? !same(current[k], snapshot[k]) : true;
});
const show = (v) => (JSON.stringify(v) ?? "—").slice(0, 110);
if (conflicts.length) {
  console.log(`\n${conflicts.length} field(s) were changed in the portal since the last load, and the file would overwrite them:`);
  for (const k of conflicts) {
    console.log(`  ${k}\n    portal now:  ${show(current[k])}\n    venue file:  ${show(planned[k])}`);
    if (snapshot && k in snapshot) console.log(`    last loaded: ${show(snapshot[k])}`);
  }
  console.log("Copy the portal's value into the venue file to keep it, or re-run with --overwrite to replace it.");
  if (apply && !overwrite) {
    console.error("\nRefusing to write: nothing was changed.");
    process.exit(1);
  }
} else {
  console.log("No portal edits in the way.");
}

if (!apply) {
  console.log("\nDry run — nothing written. Re-run with --apply to load it.");
  process.exit(0);
}

// ------------------------------------------------------------------ write
const upsert = (table, onConflict, rows) =>
  rest(`${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });

await upsert("experiences", "id", venue.experiences.map((e) => ({ id: e.id, ...roomRow(e) })));
if (venue.taxes?.length) await upsert("taxes", "id", venue.taxes);
if (venue.locationHours?.length) await upsert("location_hours", "location", venue.locationHours);

// Settings merge over what is stored, so fields the file doesn't mention (a
// logo uploaded in the portal, say) are kept.
for (const [key, value] of Object.entries(venue.settings ?? {})) {
  const [row] = await rest(`settings?key=eq.${encodeURIComponent(key)}&select=value`);
  const stored = row?.value ?? {};
  // booking_policies nests one level (reschedule / cancellation), so merge each.
  const merged =
    key === "booking_policies"
      ? { ...stored, ...Object.fromEntries(Object.entries(value).map(([k, v]) => [k, { ...(stored[k] ?? {}), ...v }])) }
      : { ...stored, ...value };
  await upsert("settings", "key", [{ key, value: merged, updated_at: new Date().toISOString() }]);
}
// What this load wrote, so the next one can tell portal edits from file edits.
await upsert("settings", "key", [{ key: "seed_snapshot", value: planned, updated_at: new Date().toISOString() }]);

// ------------------------------------------------------------------ verify
const rooms = await rest(`experiences?select=id,name,price_cents,min_party,max_party,windows&order=sort.asc`);
const taxes = await rest("taxes?select=name,percent,active");
const hours = await rest("location_hours?select=location");
const keys = await rest(`settings?select=key&key=in.(${Object.keys(venue.settings ?? {}).join(",")})`);
console.log("\nWritten. Read back from the database:");
for (const r of rooms) console.log(`  room  ${r.name} — ${money(r.price_cents)}, ${r.min_party}–${r.max_party} guests, ${Object.keys(r.windows ?? {}).length} weekdays scheduled`);
console.log(`  taxes ${taxes.map((t) => `${t.name} ${t.percent}%${t.active ? "" : " (off)"}`).join(", ")}`);
console.log(`  hours ${hours.map((h) => h.location).join(", ")}`);
console.log(`  settings ${keys.map((k) => k.key).join(", ")}`);
