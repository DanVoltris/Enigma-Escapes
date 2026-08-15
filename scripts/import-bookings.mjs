// Imports the bookings export from the old booking system into the `bookings`
// table, so sessions sold over there hold their slot here (every room is
// private — one live booking and the slot reads "Sold out") and show up on the
// customer's profile.
//
//   npm run import:bookings -- <file.csv> [more.csv ...] [--dry-run]
//
// Re-runnable: a booking's id and reference are derived from the old system's
// transaction id, so the same file twice refreshes rather than duplicates, and
// a later export just adds what's new. References are "VB-L<transaction>" —
// the app only ever mints hex after "VB-", so the L can never collide with a
// booking made here, and it's what marks a row as imported everywhere else.
//
// The old system files one row per session; several rows sharing a transaction
// id were one purchase, so they become one booking with several items.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LOCAL = process.env.USE_LOCAL_DATA === "true" || process.env.USE_LOCAL_DATA === "1";
const LOCAL_FILE = join(process.cwd(), ".local-data.json");
const TIMEZONE = "America/Winnipeg"; // lib/format.ts DEFAULT_LOCALE.timezone

// The old system's room names carry the venue ("Dark Hedges" doesn't, the rest
// do), so matching is on the leading part. Only where the name itself was
// changed here does an alias earn its place.
const ROOM_ALIASES = { "the lucky duck speakeasy": "Prohibition: The Lucky Duck" };

// --- CSV -------------------------------------------------------------------

// Same hand-rolled parser as the customers import: fields may hold commas,
// quotes ("" escapes one) and newlines.
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

// "114.32" -> 11432. Tax-exempt rows carry the word "Exempt" where a number
// belongs, which reads as no tax.
function money(v) {
  const n = Number.parseFloat(text(v));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function count(v) {
  const n = Number.parseInt(text(v), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// "14/02/2026" -> "2026-02-14". Day-first, like the customers export.
function isoDate(v) {
  const m = text(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// "5:00pm" -> "17:00"
function time24(v) {
  const m = text(v).match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  let h = Number.parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

// How far ahead of UTC `tz` was at a given instant (handles DST).
function tzOffsetMs(utcMs, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

// A wall-clock date+time at the venue -> the ISO instant it happened. The
// export has no zone, so "8:32am" means 8:32 in Winnipeg — stamping it as UTC
// (what a naive `${date}T${time}Z` does) would land bookings hours early and,
// for anything before 6am, on the day before.
function instantISO(date, time) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Second pass so a timestamp inside a DST change resolves against its own
  // offset rather than the neighbouring one.
  const once = wall - tzOffsetMs(wall, TIMEZONE);
  return new Date(wall - tzOffsetMs(once, TIMEZONE)).toISOString();
}

// Stable id for a legacy transaction, so re-importing updates its booking
// instead of making a second one. Shaped as a v5 UUID because the bookings
// table (and every id check in the app) wants that form.
function legacyId(transactionId) {
  const h = createHash("sha1").update(`voltris-legacy-booking:${transactionId}`).digest("hex");
  const variant = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// --- who the booking belongs to --------------------------------------------

// Sessions sold at the desk are filed under stand-in accounts: the shop's own
// address, addresses the old system minted itself (…temp@resova.com), and a
// handful of typed-in fakes. "N/A" is what it writes when there was no customer
// at all. None of them are people, so they never become a customer account —
// but the booking still holds its slot, and a name typed at the desk is worth
// keeping on it.
const PLACEHOLDER_EMAILS = [
  /^n\/a$/i,
  /\.temp@/i,
  /@resova\.com/i,
  /@temp\./i,
  /^info@gamemasterescapes\.com$/i,
  /^walk-?in/i,
  /^gmail123@gmail\.com$/i,
];
const PLACEHOLDER_NAMES = /^(n\/a|walk-?\s*in|walkin|-)$/i;

function identify(customer) {
  const email = customer.email;
  const usable = email.includes("@") && !PLACEHOLDER_EMAILS.some((re) => re.test(email));
  const firstName = text(customer.firstName);
  const lastName = text(customer.lastName);
  const named = firstName && !PLACEHOLDER_NAMES.test(firstName) && !PLACEHOLDER_NAMES.test(`${firstName} ${lastName}`.trim());
  return {
    firstName: named ? firstName : "Walk-in",
    lastName: named && !PLACEHOLDER_NAMES.test(lastName) ? lastName : "",
    email: usable ? email : "",
    // A placeholder account's phone number is shared by every walk-in filed
    // under it, so it isn't anyone's contact detail.
    phone: usable && !PLACEHOLDER_NAMES.test(customer.phone) ? customer.phone : "",
  };
}

// --- rooms -----------------------------------------------------------------

const normalize = (s) => s.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");

// "Shady Grove Sanatorium -Grant Park Shopping Centre" -> the experience whose
// name starts it. Longest name first so "Alice in Wonderland" can't be claimed
// by a shorter room that happens to prefix it.
function roomResolver(experiences) {
  const byName = [...experiences].sort((a, b) => b.name.length - a.name.length);
  return (legacyName) => {
    const alias = ROOM_ALIASES[text(legacyName).toLowerCase().replace(/\s*[-–]\s*.*$/, "").trim()];
    const wanted = normalize(alias ?? legacyName);
    return byName.find((e) => wanted.startsWith(normalize(e.name))) ?? null;
  };
}

// --- schedule --------------------------------------------------------------

const toMinutes = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMinutes = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

// Mirrors lib/schedule.ts startTimesFor — the start times a room offers on a
// date, used here only to tell whether a legacy session lands on the grid.
function startTimesFor(exp, date) {
  if (exp.schedule_mode === "times") return [...(exp.times ?? [])].sort();
  const [y, m, d] = date.split("-").map(Number);
  const dow = String(new Date(y, m - 1, d).getDay());
  if (exp.schedule_mode === "window") {
    const w = (exp.windows ?? {})[dow];
    if (!w || w.closed) return [];
    if (w.times?.length) return [...w.times].sort();
    const out = [];
    for (let t = toMinutes(w.first); t <= toMinutes(w.last) && out.length < 96; t += Math.max(5, exp.interval_minutes)) {
      out.push(fromMinutes(t));
    }
    return out;
  }
  return []; // "store" mode needs location hours; no room uses it here
}

// --- row -> item -----------------------------------------------------------

function toItem(get, resolve) {
  const legacyRoom = text(get("Booking Item"));
  const date = isoDate(get("Booking Start Date"));
  const time = time24(get("Booking Start Time"));
  const quantity = count(get("Booking Quantity (Total Participants)"));
  const exp = resolve(legacyRoom);
  if (!exp) return { skip: "room", detail: legacyRoom };
  if (!date || !time) return { skip: "when", detail: `${text(get("Booking Start Date"))} ${text(get("Booking Start Time"))}` };
  if (!quantity) return { skip: "quantity", detail: legacyRoom };

  const subtotalCents = money(get("Booking Subtotal")) || money(get("Booking Item Subtotal"));
  const netCents = money(get("Booking Net Total"));
  return {
    exp,
    item: {
      roomId: exp.id,
      roomName: exp.name,
      location: exp.location,
      date,
      time,
      quantity,
      // Per head, as the app stores it. The booking's money comes from the
      // export's own totals below, so the rounding here never moves a price.
      priceCents: Math.round(subtotalCents / quantity),
      durationMinutes: exp.duration_minutes,
      depositPercent: Number(exp.deposit_percent ?? 25),
      badgeBg: exp.badge_bg,
      badgeFg: exp.badge_fg,
    },
    money: {
      subtotalCents,
      // Discounts and gift vouchers both land in the export as the gap between
      // the subtotal and the net, which is the one figure that always adds up.
      discountCents: Math.max(0, subtotalCents - netCents),
      gstCents: money(get("Booking Total Taxes")),
      totalCents: money(get("Booking Total")),
    },
    noShow: text(get("Booking Status")).toLowerCase() === "no-show",
    legacyBookingId: text(get("Booking ID")),
    // Gift vouchers come through as a discount code too; only a real promo is
    // worth carrying over as one.
    promoCode: (() => {
      const applied = text(get("Booking Discount Codes Applied"));
      if (!applied || /gift voucher/i.test(applied)) return null;
      return applied.split(/\s+-\s+/)[0].trim().slice(0, 40) || null;
    })(),
  };
}

// --- main ------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const files = args.filter((a) => !a.startsWith("--"));

// When exports disagree, the newest one is right — a booking unpaid in the
// morning's export and paid in the afternoon's has been paid. Exports carry a
// 14-digit stamp in their filename; a renamed file falls back to its mtime.
// Sorted oldest first so the newest row simply overwrites what came before.
function exportedAt(file) {
  const named = basename(file).match(/(\d{14})/);
  if (named) return named[1];
  try {
    const d = statSync(file).mtime;
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  } catch {
    return "";
  }
}
files.sort((a, b) => exportedAt(a).localeCompare(exportedAt(b)));

if (!files.length) {
  console.error("Usage: npm run import:bookings -- <file.csv> [more.csv ...] [--dry-run]");
  process.exit(1);
}
if (!LOCAL && (!BASE || !KEY)) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run it through the npm script so .env.local is loaded: npm run import:bookings -- <file.csv>"
  );
  process.exit(1);
}

async function rest(path, init) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

function localStore() {
  if (!existsSync(LOCAL_FILE)) {
    console.error(
      `USE_LOCAL_DATA is set but ${LOCAL_FILE} doesn't exist yet.\n` +
        "Start the app once (npm run dev) so the local store is seeded, then re-run."
    );
    process.exit(1);
  }
  return JSON.parse(readFileSync(LOCAL_FILE, "utf8"));
}

// The catalogue: names to match against, and the colours/duration a booking's
// items carry.
let experiences;
if (LOCAL) {
  experiences = localStore().experiences ?? [];
} else {
  const res = await rest("experiences?select=*");
  if (!res.ok) {
    console.error(`Could not load experiences (HTTP ${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  experiences = await res.json();
}
if (!experiences.length) {
  console.error("No experiences found — nothing to match the old system's rooms against.");
  process.exit(1);
}
const resolve = roomResolver(experiences);

const transactions = new Map();
const unknownRooms = new Map();
const skipped = { cancelled: 0, when: 0, quantity: 0, room: 0, duplicate: 0 };
let dataRows = 0;

// What was actually paid, per transaction, from a transactions export.
//
// The bookings export only says "Paid" or "Unpaid", and the old system marks a
// transaction Unpaid until it is settled in full — so a $30 deposit on a $120
// booking exports as simply Unpaid, and importing that alone tells the desk to
// collect the whole $120 again. The transactions export carries Total Paid per
// transaction, which is the only place the deposit actually appears.
const paidByTx = new Map();
let paidRows = 0;

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

  // A transactions export: no per-session rows, but it knows what was paid.
  if (index.has("Total Paid") && !index.has("Booking Item")) {
    const txCol = index.get("Transaction ID");
    const paidCol = index.get("Total Paid");
    for (const row of body) {
      const id = text(row[txCol]);
      if (!id) continue;
      paidByTx.set(id, money(row[paidCol]));
      paidRows++;
    }
    console.log(`${basename(file)}: ${paidRows} transactions with payment totals`);
    continue;
  }

  for (const required of ["Transaction ID", "Booking Item", "Booking Start Date", "Booking Start Time"]) {
    if (!index.has(required)) {
      console.error(`${file} has no "${required}" column — is it a bookings or transactions export?`);
      process.exit(1);
    }
  }

  let fileRows = 0;
  for (const row of body) {
    if (row.length === 1 && !row[0].trim()) continue; // trailing blank line
    dataRows++;
    fileRows++;
    const get = (name) => (index.has(name) ? row[index.get(name)] : "");

    // Only live transactions hold a slot; anything cancelled or refunded over
    // there shouldn't take one here.
    if (text(get("Transaction Status")).toLowerCase() !== "active") { skipped.cancelled++; continue; }

    const parsed = toItem(get, resolve);
    if (parsed.skip) {
      skipped[parsed.skip]++;
      if (parsed.skip === "room") unknownRooms.set(parsed.detail, (unknownRooms.get(parsed.detail) ?? 0) + 1);
      continue;
    }

    const txId = text(get("Transaction ID"));
    let tx = transactions.get(txId);
    if (!tx) {
      const bookedOn = isoDate(get("Transaction Date"));
      const bookedAt = time24(get("Transaction Time"));
      tx = {
        id: txId,
        source: text(get("Source")).toLowerCase() === "dashboard" ? "in_person" : "online",
        paid: text(get("Transaction Payment Status")).toLowerCase() === "paid",
        createdAt: bookedOn ? instantISO(bookedOn, bookedAt ?? "12:00") : null,
        customer: {
          firstName: text(get("Customer First Name")),
          lastName: text(get("Customer Last Name")),
          email: text(get("Customer Email Address")),
          phone: text(get("Customer Cell Phone")) || text(get("Customer Telephone")),
        },
        // Keyed by legacy booking id: exports overlap at their edges, so the
        // same session arrives more than once and must count once. Files are
        // processed oldest first, so a later export's version simply replaces
        // the earlier one — that's how a payment made after the first export
        // reaches us.
        rows: new Map(),
        noShow: false,
        promoCode: null,
        sourceFile: basename(file),
      };
      transactions.set(txId, tx);
    }
    if (tx.rows.has(parsed.legacyBookingId)) skipped.duplicate++;
    tx.rows.set(parsed.legacyBookingId, parsed);
    // Transaction-level facts come from whichever export is newest, for the
    // same reason: payment status in particular changes after the fact.
    tx.paid = text(get("Transaction Payment Status")).toLowerCase() === "paid";
    tx.source = text(get("Source")).toLowerCase() === "dashboard" ? "in_person" : "online";
    tx.sourceFile = basename(file);
    tx.noShow = parsed.noShow || [...tx.rows.values()].some((r) => r.noShow);
    tx.promoCode = parsed.promoCode ?? tx.promoCode;
  }
  console.log(`${basename(file)}: ${fileRows} rows`);
}

// Cap at the total: an overpayment recorded over there is not a refund we can
// safely invent here.
let partPaid = 0;
function paidFor(tx) {
  const total = tx.money.totalCents;
  if (paidByTx.has(tx.id)) {
    const paid = Math.max(0, Math.min(total, paidByTx.get(tx.id)));
    if (paid > 0 && paid < total) partPaid++;
    return paid;
  }
  return tx.paid ? total : 0;
}

const bookings = [];
let walkIns = 0;
for (const tx of transactions.values()) {
  const person = identify(tx.customer);
  if (!person.email) walkIns++;
  // Totals are summed from the surviving rows rather than accumulated as rows
  // arrive, so a replaced row takes its money with it.
  const rows = [...tx.rows.values()];
  tx.items = rows.map((r) => r.item);
  tx.money = { subtotalCents: 0, discountCents: 0, gstCents: 0, totalCents: 0 };
  for (const r of rows) for (const k of Object.keys(tx.money)) tx.money[k] += r.money[k];
  tx.legacyBookingIds = [...tx.rows.keys()];
  bookings.push({
    id: legacyId(tx.id),
    reference: `VB-L${tx.id}`,
    created_at: tx.createdAt ?? instantISO(tx.items[0].date, tx.items[0].time),
    customer: { ...person, subscribe: false },
    items: tx.items,
    promo_code: tx.promoCode,
    payment_option: "full",
    pricing: {
      subtotalCents: tx.money.subtotalCents,
      discountCents: tx.money.discountCents,
      gstCents: tx.money.gstCents,
      totalCents: tx.money.totalCents,
      // What was actually paid, if a transactions export said so — that's the
      // only place a part payment shows. Failing that, fall back to the
      // bookings export's all-or-nothing flag. Capped at the total: where the
      // old system recorded an overpayment, inventing a refund here would be a
      // guess, and the balance reading zero is the safe reading.
      paidCents: paidFor(tx),
      balanceCents: tx.money.totalCents - paidFor(tx),
    },
    source: tx.source,
    no_show: tx.noShow,
    notes: [
      {
        id: legacyId(`note:${tx.id}`),
        text: `Imported from the previous booking system — transaction ${tx.id}, booking ${tx.legacyBookingIds.join(", ")} (${tx.sourceFile}).`,
        at: new Date().toISOString(),
        author: "System",
      },
    ],
  });
}

// Sessions the old system ran off the published grid (a staff-moved start, a
// school group at 9:30am). The booking still imports, but availability keys on
// an exact start time, so the slot it really occupies has to be taken out of
// service by hand or the room can be sold twice. Past dates can't be booked, so
// only today onward is worth blocking.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
const expById = new Map(experiences.map((e) => [e.id, e]));
const blocks = new Map();
let offGrid = 0;
for (const booking of bookings) {
  for (const item of booking.items) {
    const exp = expById.get(item.roomId);
    const grid = startTimesFor(exp, item.date);
    if (grid.includes(item.time)) continue;
    offGrid++;
    if (item.date < today) continue;
    const from = toMinutes(item.time);
    const to = from + exp.duration_minutes;
    for (const start of grid) {
      const s = toMinutes(start);
      if (s < to && s + exp.duration_minutes > from) {
        blocks.set(`${item.roomId}|${item.date}|${start}`, {
          room_id: item.roomId,
          date: item.date,
          time: start,
          reason: `Booked in the previous system at ${item.time} (${booking.reference})`,
        });
      }
    }
  }
}

const sessions = bookings.reduce((s, b) => s + b.items.length, 0);
const guests = bookings.reduce((s, b) => s + b.items.reduce((t, i) => t + i.quantity, 0), 0);
const upcoming = bookings.filter((b) => b.items.some((i) => i.date >= today)).length;
const withEmail = new Set(bookings.filter((b) => b.customer.email).map((b) => b.customer.email.toLowerCase()));

console.log(
  `\n${dataRows} rows read → ${bookings.length} bookings · ${sessions} sessions · ${guests} guests` +
    `\n${upcoming} of them are today or later (those are the slots that stop being sellable)` +
    `\n${withEmail.size} customer accounts linked by email · ${walkIns} walk-ins filed under a placeholder account`
);
if (partPaid) {
  console.log(`  ${partPaid} bookings carry a part payment (a deposit) taken from the transactions export`);
}
if (skipped.duplicate) console.log(`  ${skipped.duplicate} rows skipped — the same legacy booking in more than one export`);
if (skipped.cancelled) console.log(`  ${skipped.cancelled} rows skipped — transaction not active`);
if (skipped.when) console.log(`  ${skipped.when} rows skipped — unreadable date or time`);
if (skipped.quantity) console.log(`  ${skipped.quantity} rows skipped — no party size`);
if (unknownRooms.size) {
  console.log(`  ${skipped.room} rows skipped — no matching experience here:`);
  for (const [name, n] of [...unknownRooms].sort((a, b) => b[1] - a[1])) console.log(`      ${n}\t${name}`);
}
if (offGrid) {
  console.log(
    `  ${offGrid} sessions don't sit on the room's published start times` +
      (blocks.size ? ` → ${blocks.size} overlapping slots will be blocked off` : " (all in the past — nothing to block)")
  );
}

// Bookings hang off the customer's email, so this is the linkage: every one of
// these emails that already has a row in `customers` (from the customers
// import) gets its sessions listed on that profile. The rest still show up on
// the Customers tab — it lists everyone who has booked, account row or not.
if (!LOCAL) {
  // Compared lowercased, because that's how the app matches a booking to an
  // account and the old system's exports aren't consistent about case.
  const accounts = new Set();
  for (let page = 0; page < 100; page++) {
    const res = await rest(`customers?select=email&limit=1000&offset=${page * 1000}`);
    if (!res.ok) { accounts.clear(); break; }
    const batch = await res.json();
    for (const r of batch) accounts.add(String(r.email).toLowerCase());
    if (batch.length < 1000) break;
  }
  if (accounts.size) {
    const known = [...withEmail].filter((e) => accounts.has(e)).length;
    console.log(
      `  ${known} of those emails already have a customer account · ` +
        `${withEmail.size - known} will appear on the Customers tab from these bookings alone`
    );
  }
}

if (dryRun) {
  const wanted = (args.find((a) => a.startsWith("--show=")) || "").slice(7);
  const sample = wanted ? bookings.find((b) => b.reference === `VB-L${wanted}`) : bookings[0];
  if (wanted && !sample) console.log(`\n--dry-run: nothing written. No booking for transaction ${wanted}.`);
  else {
    console.log(`\n--dry-run: nothing written. ${wanted ? "Matched" : "Sample"} booking:`);
    console.log(JSON.stringify(sample, null, 2));
  }
  process.exit(0);
}

// --- write -----------------------------------------------------------------

if (LOCAL) {
  const store = localStore();
  const existing = Array.isArray(store.bookings) ? store.bookings : [];
  const merged = new Map(existing.map((b) => [b.id, b]));
  for (const b of bookings) merged.set(b.id, b);
  store.bookings = [...merged.values()];
  const existingBlocks = Array.isArray(store.slot_blocks) ? store.slot_blocks : [];
  const blockKey = (b) => `${b.room_id}|${b.date}|${b.time}`;
  const mergedBlocks = new Map(existingBlocks.map((b) => [blockKey(b), b]));
  for (const [key, b] of blocks) {
    if (!mergedBlocks.has(key)) mergedBlocks.set(key, { id: legacyId(`block:${key}`), created_at: new Date().toISOString(), ...b });
  }
  store.slot_blocks = [...mergedBlocks.values()];
  writeFileSync(LOCAL_FILE, JSON.stringify(store, null, 2));
  console.log(`\nDone — ${bookings.length} bookings and ${blocks.size} blocks written to .local-data.json (local mode).`);
  process.exit(0);
}

const CHUNK = 100;

// A dropped socket shouldn't cost a whole run — this one is ~270 requests.
// Retrying is safe: every write is an idempotent upsert on the booking id.
// Only transport failures and 5xx are retried; a 4xx means the request itself
// is wrong, so retrying would just fail three times more slowly.
const ATTEMPTS = 3;
async function postChunk(path, chunk, prefer) {
  for (let attempt = 1; ; attempt++) {
    let why;
    try {
      const res = await rest(path, {
        method: "POST",
        headers: { Prefer: prefer },
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
for (let i = 0; i < bookings.length; i += CHUNK) {
  const chunk = bookings.slice(i, i + CHUNK);
  let res;
  try {
    res = await postChunk("bookings?on_conflict=id", chunk, "resolution=merge-duplicates,return=minimal");
  } catch (err) {
    console.error(
      `\nNetwork failure on bookings ${i + 1}–${i + chunk.length} after ${ATTEMPTS} attempts: ` +
        `${err.cause?.code || err.code || err.message}`
    );
    console.error(`${written} bookings were written before this failed.`);
    console.error("Re-run the same command — every write is an upsert, so nothing is duplicated.");
    process.exit(1);
  }
  if (!res.ok) {
    const body = await res.text();
    console.error(`\nFailed on bookings ${i + 1}–${i + chunk.length} (HTTP ${res.status}): ${body}`);
    if (body.includes("notes")) {
      console.error(
        "\nThe `notes` column is probably missing. Run this in the Supabase SQL editor first:\n" +
          "  alter table bookings add column if not exists notes jsonb not null default '[]'::jsonb;"
      );
    }
    console.error(`${written} bookings were written before this failed.`);
    process.exit(1);
  }
  written += chunk.length;
  process.stdout.write(`\rwriting… ${written}/${bookings.length}`);
}
console.log(`\n${written} bookings in the Bookings tab.`);

if (blocks.size) {
  const rows = [...blocks.values()].map((b) => ({ id: legacyId(`block:${b.room_id}|${b.date}|${b.time}`), created_at: new Date().toISOString(), ...b }));
  const res = await rest("slot_blocks?on_conflict=room_id,date,time", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`\nBookings are in, but blocking the off-grid slots failed (HTTP ${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  console.log(`${rows.length} overlapping slots blocked off (Calendar → Blocked hours).`);
}
console.log("Done.");
