// Imports customer exports from the old booking system into the `customers`
// table. Re-runnable: rows are upserted on email, so the same file twice is a
// no-op and a later export just refreshes what it covers.
//
//   npm run import:customers -- <file.csv> [more.csv ...] [--dry-run]
//
// Column layout has changed between exports (the July file carries address
// columns the August one doesn't), so everything is looked up by header name
// rather than position. Unknown headers are ignored; a missing header a row
// needs is reported instead of being silently blank.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// With USE_LOCAL_DATA set the app runs off .local-data.json instead of
// Supabase (lib/local-db.ts), so import there too — it's the way to see a real
// import in the portal without touching production.
const LOCAL = process.env.USE_LOCAL_DATA === "true" || process.env.USE_LOCAL_DATA === "1";
const LOCAL_FILE = join(process.cwd(), ".local-data.json");

// The old system files walk-ins under placeholder accounts. They aren't people
// and would show up as customers nobody can contact, so they're left out — but
// listed at the end so nothing disappears quietly.
const PLACEHOLDER_EMAILS = [/^info@gamemasterescapes\.com$/i, /^walkinn@resova\.com/i];

// --- CSV -------------------------------------------------------------------

// Full-quoting parser: fields may contain commas, quotes ("" escapes one) and
// newlines. Hand-rolled because it's 30 lines and saves a dependency.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// --- field readers ---------------------------------------------------------

const text = (v) => (v ?? "").trim();

function money(v) {
  const n = Number.parseFloat(text(v));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function count(v) {
  const n = Number.parseInt(text(v), 10);
  return Number.isFinite(n) ? n : 0;
}

// "14/02/2026 - 8:32am" -> "2026-02-14T08:32:00.000Z". Day-first: the export is
// UK-ordered (13/08 appears, so it can't be month-first).
function joinedAt(v) {
  const m = text(v).match(/^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!m) return null;
  const [, d, mo, y, rawH, min, ampm] = m;
  let h = Number.parseInt(rawH, 10) % 12;
  if (ampm.toLowerCase() === "pm") h += 12;
  return `${y}-${mo}-${d}T${String(h).padStart(2, "0")}:${min}:00.000Z`;
}

// "N/A" is the export's empty marker for these two.
const orNull = (v) => {
  const t = text(v);
  return t && t !== "N/A" ? t : null;
};

// --- row -> customer -------------------------------------------------------

function toCustomer(get, sourceFile, stamp) {
  const email = text(get("Email Address"));
  if (!email || !email.includes("@")) return null;
  if (PLACEHOLDER_EMAILS.some((re) => re.test(email))) return { placeholder: email };

  const telephone = text(get("Telephone"));
  const cell = text(get("Cell Phone"));

  return {
    exportedAt: stamp,
    email,
    firstName: text(get("First Name")),
    lastName: text(get("Last Name")),
    phone: telephone || cell,
    subscribe: text(get("Subscribed to Emails")).toLowerCase() === "true",
    createdAt: joinedAt(get("Joined Date/Time")),
    imported: {
      source: sourceFile,
      legacyId: text(get("Visitor/Customer ID")) || null,
      joinedAt: text(get("Joined Date/Time")) || null,
      altPhone: telephone && cell ? cell : null, // only when it isn't already `phone`
      dob: orNull(get("DOB")),
      transactions: count(get("Total Number of Transactions")),
      bookings: count(get("Total Number of Bookings")),
      bookingValueCents: money(get("Total Value of Bookings")),
      paidCents: money(get("Total Value of Payments Paid")),
      unpaidCents: money(get("Total Value of Payments Unpaid")),
      overpaidCents: money(get("Total Value of Payments Overpaid")),
      creditCents: money(get("Total Customer Credit")),
      creditRemainingCents: money(get("Remaining Customer Credit")),
      vouchers: count(get("Total Number of Gift Vouchers")),
      voucherValueCents: money(get("Total Value of Gift Vouchers")),
      waiver: orNull(get("Waiver Signed")),
      lastAttended: orNull(get("Last Attended")),
      lastItem: orNull(get("Last Item Booked")),
    },
  };
}

// Exports overlap: the same legacy account appears in every file covering its
// date range. The 14-digit stamp in the filename (…20260813070627.csv) says
// which export is newer, so a repeat of the same account refreshes rather than
// doubling up — the totals in a later export already include the earlier ones.
// Renamed files (old.csv, done.csv) lose that stamp, so fall back to when the
// file was last written, which for a download is when it arrived.
function exportedAt(file) {
  const named = basename(file).match(/(\d{14})/);
  if (named) return named[1];
  try {
    // Local time, so it lines up with the filename stamps rather than sorting
    // a renamed file hours ahead of a timestamped one.
    const d = statSync(file).mtime;
    const p = (v) => String(v).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  } catch {
    return null;
  }
}

// Same email, same legacy id = one account seen twice: keep the newer export's
// figures wholesale. Same email, different legacy id = one person under two
// accounts: their history genuinely adds up.
function mergeImported(older, newer) {
  const sameAccount =
    older.imported.legacyId && older.imported.legacyId === newer.imported.legacyId;
  if (sameAccount) {
    const olderIsNewer =
      (older.exportedAt || "") > (newer.exportedAt || "") ? older : null;
    return olderIsNewer ?? newer;
  }
  const sum = (k) => (older.imported[k] || 0) + (newer.imported[k] || 0);
  const latest = (a, b) => (a && b ? (a > b ? a : b) : a || b);
  return {
    ...newer,
    createdAt: older.createdAt && newer.createdAt
      ? (older.createdAt < newer.createdAt ? older.createdAt : newer.createdAt)
      : older.createdAt || newer.createdAt,
    subscribe: older.subscribe || newer.subscribe,
    phone: newer.phone || older.phone,
    imported: {
      ...newer.imported,
      mergedFrom: [older.imported.legacyId, newer.imported.legacyId].filter(Boolean),
      transactions: sum("transactions"),
      bookings: sum("bookings"),
      bookingValueCents: sum("bookingValueCents"),
      paidCents: sum("paidCents"),
      unpaidCents: sum("unpaidCents"),
      overpaidCents: sum("overpaidCents"),
      creditCents: sum("creditCents"),
      creditRemainingCents: sum("creditRemainingCents"),
      vouchers: sum("vouchers"),
      voucherValueCents: sum("voucherValueCents"),
      lastAttended: latest(older.imported.lastAttended, newer.imported.lastAttended),
      lastItem: latest(older.imported.lastAttended, newer.imported.lastAttended) === older.imported.lastAttended
        ? older.imported.lastItem
        : newer.imported.lastItem,
    },
  };
}

// --- main ------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const files = args.filter((a) => !a.startsWith("--"));

if (!files.length) {
  console.error("Usage: npm run import:customers -- <file.csv> [more.csv ...] [--dry-run]");
  process.exit(1);
}
if (!dryRun && !LOCAL && (!BASE || !KEY)) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run it through the npm script so .env.local is loaded: npm run import:customers -- <file.csv>"
  );
  process.exit(1);
}

const byEmail = new Map();
const placeholders = [];
let dataRows = 0;
let skipped = 0;
let merged = 0;
let refreshed = 0;

for (const file of files) {
  let rows;
  try {
    rows = parseCsv(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`Can't read ${file}: ${err.message}`);
    process.exit(1);
  }
  const [header, ...body] = rows;
  if (!header) {
    console.error(`${file} is empty.`);
    process.exit(1);
  }
  const index = new Map(header.map((h, i) => [h.trim(), i]));
  for (const required of ["Email Address", "First Name", "Last Name"]) {
    if (!index.has(required)) {
      console.error(`${file} has no "${required}" column — is it a customers export?`);
      process.exit(1);
    }
  }

  const stamp = exportedAt(file);
  let fileRows = 0;
  for (const row of body) {
    if (row.length === 1 && !row[0].trim()) continue; // trailing blank line
    dataRows++;
    fileRows++;
    const get = (name) => (index.has(name) ? row[index.get(name)] : "");
    const c = toCustomer(get, basename(file), stamp);
    if (!c) { skipped++; continue; }
    if (c.placeholder) { placeholders.push(c.placeholder); continue; }
    const key = c.email.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      if (existing.imported.legacyId === c.imported.legacyId) refreshed++;
      else merged++;
      byEmail.set(key, mergeImported(existing, c));
    } else byEmail.set(key, c);
  }
  console.log(`${basename(file)}: ${fileRows} rows${stamp ? "" : " (no export date in the filename)"}`);
}

const customers = [...byEmail.values()];
console.log(
  `\n${dataRows} rows read → ${customers.length} customers` +
    `${refreshed ? ` · ${refreshed} refreshed from a newer export` : ""}` +
    `${merged ? ` · ${merged} second accounts merged into an existing email` : ""}` +
    `${skipped ? ` · ${skipped} skipped with no usable email` : ""}` +
    `${placeholders.length ? ` · ${placeholders.length} walk-in placeholder rows left out` : ""}`
);
if (placeholders.length) console.log(`  left out: ${[...new Set(placeholders)].join(", ")}`);

const withHistory = customers.filter((c) => c.imported.bookings > 0).length;
const totalPaid = customers.reduce((s, c) => s + c.imported.paidCents, 0);
console.log(
  `${withHistory} have booking history · $${(totalPaid / 100).toFixed(2)} paid in total (legacy figures)`
);

if (dryRun) {
  const wanted = (args.find((a) => a.startsWith("--show=")) || "").slice(7).toLowerCase();
  const sample = wanted ? byEmail.get(wanted) : customers[0];
  if (wanted && !sample) console.log(`\n--dry-run: nothing written. No customer with email ${wanted}.`);
  else {
    console.log(`\n--dry-run: nothing written. ${wanted ? "Matched" : "Sample"} row:`);
    console.log(JSON.stringify(sample, null, 2));
  }
  process.exit(0);
}

const rowsToWrite = customers.map((c) => ({
  // Lowercased because the primary key is case-sensitive but every reader
  // (lib/customers.ts) looks up by the lowercased address. Exports disagree on
  // casing for the same person, so raw casing means unreachable rows.
  email: c.email.toLowerCase(),
  first_name: c.firstName,
  last_name: c.lastName,
  phone: c.phone,
  subscribe: c.subscribe,
  ...(c.createdAt ? { created_at: c.createdAt } : {}),
  imported: c.imported,
}));

if (LOCAL) {
  if (!existsSync(LOCAL_FILE)) {
    console.error(
      `USE_LOCAL_DATA is set but ${LOCAL_FILE} doesn't exist yet.\n` +
        "Start the app once (npm run dev) so the local store is seeded, then re-run."
    );
    process.exit(1);
  }
  const store = JSON.parse(readFileSync(LOCAL_FILE, "utf8"));
  const existing = Array.isArray(store.customers) ? store.customers : [];
  const merged = new Map(existing.map((r) => [String(r.email).toLowerCase(), r]));
  for (const row of rowsToWrite) merged.set(row.email.toLowerCase(), { ...merged.get(row.email.toLowerCase()), ...row });
  store.customers = [...merged.values()];
  writeFileSync(LOCAL_FILE, JSON.stringify(store, null, 2));
  console.log(`Done — ${rowsToWrite.length} customers written to .local-data.json (local mode).`);
  process.exit(0);
}

const CHUNK = 200;

// A dropped socket shouldn't cost a whole run. Retrying is always safe here:
// every write is an idempotent upsert on email. Only transport failures and
// 5xx are retried — a 4xx means the request itself is wrong, so retrying it
// would just fail three times more slowly.
const ATTEMPTS = 3;
async function postChunk(chunk) {
  for (let attempt = 1; ; attempt++) {
    let why;
    try {
      const res = await fetch(`${BASE}/rest/v1/customers?on_conflict=email`, {
        method: "POST",
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(chunk),
      });
      if (res.ok || res.status < 500 || attempt >= ATTEMPTS) return res;
      why = `HTTP ${res.status}`;
    } catch (err) {
      if (attempt >= ATTEMPTS) throw err;
      why = err.cause?.code || err.code || err.message;
    }
    process.stdout.write(`\n${why} — retrying (attempt ${attempt + 1} of ${ATTEMPTS})…\n`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}

let written = 0;
for (let i = 0; i < rowsToWrite.length; i += CHUNK) {
  const chunk = rowsToWrite.slice(i, i + CHUNK);
  let res;
  try {
    res = await postChunk(chunk);
  } catch (err) {
    console.error(
      `\nNetwork failure on rows ${i + 1}–${i + chunk.length} after ${ATTEMPTS} attempts: ` +
        `${err.cause?.code || err.code || err.message}`
    );
    console.error(`${written} customers were written before this failed.`);
    console.error("Re-run the same command — every write is an upsert, so nothing is duplicated.");
    process.exit(1);
  }
  if (!res.ok) {
    const body = await res.text();
    console.error(`\nFailed on rows ${i + 1}–${i + chunk.length} (HTTP ${res.status}): ${body}`);
    if (body.includes("imported")) {
      console.error(
        "\nThe `imported` column is probably missing. Run this in the Supabase SQL editor first:\n" +
          "  alter table customers add column if not exists imported jsonb;"
      );
    }
    console.error(`${written} customers were written before this failed.`);
    process.exit(1);
  }
  written += chunk.length;
  process.stdout.write(`\rwriting… ${written}/${rowsToWrite.length}`);
}
console.log(`\nDone — ${written} customers in the Customers tab.`);
