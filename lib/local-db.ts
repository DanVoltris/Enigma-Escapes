// Local, file-backed stand-in for Supabase — used when USE_LOCAL_DATA is set so
// the whole app runs with no database (see lib/supabase.ts). It emulates just
// the handful of PostgREST query patterns this codebase actually uses, so every
// data module (db.ts, experiences.ts, settings.ts, taxes.ts, hours.ts) keeps
// working unchanged. Data is seeded on first use and persisted to a gitignored
// JSON file at the project root, so bookings and edits survive restarts.
//
// This is a development convenience, not a real database: it has no schema
// enforcement, no concurrency control and no backups. Delete .local-data.json
// to reset to the seed data below.
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;

const DATA_FILE = path.join(process.cwd(), ".local-data.json");

// Primary key per table — used to resolve upserts (merge-duplicates / on_conflict).
const PK: Record<string, string> = {
  bookings: "id",
  promo_codes: "code",
  staff_notes: "id",
  activity_log: "id",
  experiences: "id",
  taxes: "id",
  settings: "key",
  location_hours: "location",
  feedback: "reference", // one survey response per booking; resubmit overwrites
  customers: "email", // manually added customers; re-adding an email updates it
  booking_requests: "id", // sub-4h booking requests awaiting manager approval
  slot_blocks: "id", // manager-blocked slots (maintenance, private events)
  staff_accounts: "id", // portal logins
  staff_sessions: "token_hash", // active staff sessions (revocable)
  gift_vouchers: "code", // prepaid dollar balances
  reward_codes: "code", // 20%-off codes texted after a booking
  staff_members: "id", // the people who run the games (not logins)
  staff_shifts: "id", // check in / check out records
};

// Query-string keys that are PostgREST directives, not column filters.
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

let store: Store | null = null;
let loadedMtime = 0; // mtime of the file our in-memory copy came from

function nowISO(): string {
  return new Date().toISOString();
}

// Next.js dev gives each route its own instance of this module, so several
// in-memory copies of the store coexist. The file is the source of truth:
// re-read it whenever another instance has written a newer version (cheap
// stat per query — fine for a dev store).
function load(): Store {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const mtime = fs.statSync(DATA_FILE).mtimeMs;
      if (!store || mtime !== loadedMtime) {
        store = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as Store;
        loadedMtime = mtime;
        // Make sure every known table exists so inserts/upserts always have a home.
        for (const table of Object.keys(PK)) if (!store[table]) store[table] = [];
      }
      return store;
    }
  } catch (err) {
    console.error("local-db: could not read", DATA_FILE, "— reseeding.", err);
  }
  if (!store) store = seed();
  persist();
  return store;
}

function persist(): void {
  if (!store) return;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
    loadedMtime = fs.statSync(DATA_FILE).mtimeMs; // don't re-read our own write
  } catch (err) {
    console.error("local-db: could not write", DATA_FILE, err);
  }
}

// ---------- PostgREST-compatible request handling ----------

// Entry point used by lib/supabase.ts. Mirrors the shape of a fetch() Response
// so callers can use res.ok / res.status / res.json() / res.text() unchanged.
export async function localRest(reqPath: string, init?: RequestInit): Promise<Response> {
  const db = load();
  const [tableName, qs] = reqPath.split("?");
  const table = tableName.trim();
  const params = new URLSearchParams(qs ?? "");
  const method = (init?.method ?? "GET").toUpperCase();

  // Database functions the app calls through PostgREST. Real Postgres does the
  // grouping; here it's done in JS so screens that depend on them still render
  // against the mock store.
  if (table.startsWith("rpc/")) {
    const vouchers = db.gift_vouchers ?? [];
    if (table === "rpc/voucher_totals") {
      const live = vouchers.filter((v) => v.active && Number(v.remaining_cents) > 0);
      return json(
        {
          total: vouchers.length,
          face: vouchers.reduce((n, v) => n + Number(v.face_cents ?? 0), 0),
          outstanding: vouchers.reduce((n, v) => n + Number(v.remaining_cents ?? 0), 0),
          live: live.length,
        },
        200
      );
    }
    if (table === "rpc/voucher_product_stats") {
      const by = new Map<number, { face_cents: number; issued: number; spent: number; value_cents: number }>();
      for (const v of vouchers) {
        const face = Number(v.face_cents ?? 0);
        const row = by.get(face) ?? { face_cents: face, issued: 0, spent: 0, value_cents: 0 };
        row.issued += 1;
        row.value_cents += face;
        if (Number(v.remaining_cents ?? 0) <= 0) row.spent += 1;
        by.set(face, row);
      }
      return json([...by.values()], 200);
    }
    return json({ message: `unknown function ${table}` }, 404);
  }

  if (!(table in PK)) return json([], 404); // unknown table → behave like "not created yet"
  const rows = db[table] ?? (db[table] = []);

  if (method === "GET") {
    let result = rows.filter((r) => matchesFilters(r, params));
    const matched = result.length; // before paging — that's what count=exact means
    result = applyOrder(result, params.get("order"));
    // offset before limit, so paging through a big table (lib/customers.ts)
    // walks it instead of handing back the same first page every time.
    const offset = Number(params.get("offset") ?? 0);
    if (offset > 0) result = result.slice(offset);
    const limit = params.get("limit");
    if (limit) result = result.slice(0, Number(limit));
    // Prefer: count=exact asks for the total in a header instead of the rows
    // (lib/experiences.ts counts a room's bookings that way). Without it local
    // mode answers "none" — which is the answer that unlocks a delete.
    const headers = /count=exact/.test(preferHeader(init))
      ? { "content-range": `${offset}-${offset + Math.max(0, result.length - 1)}/${matched}` }
      : undefined;
    return json(result, 200, headers);
  }

  // PostgREST returns the affected rows when asked; callers use that to tell a
  // write that matched nothing from one that changed something (a
  // compare-and-swap depends on the difference). Returning an empty 204 here
  // regardless would make local mode disagree with the real database.
  const wantsRows = /return=representation/.test(preferHeader(init));

  if (method === "POST") {
    const body = parseBody(init);
    const items = Array.isArray(body) ? body : [body];
    const upsert = /merge-duplicates/.test(preferHeader(init)) || params.has("on_conflict");
    const pk = params.get("on_conflict") ?? PK[table];
    const written: Row[] = [];
    for (const raw of items) {
      const item = { ...(raw as Row) };
      if (upsert) {
        const idx = rows.findIndex((r) => r[pk] === item[pk]);
        if (idx >= 0) {
          rows[idx] = { ...rows[idx], ...item };
          written.push(rows[idx]);
          continue;
        }
      }
      if (item.created_at == null) item.created_at = nowISO(); // mimic DB default now()
      rows.push(item);
      written.push(item);
    }
    persist();
    return json(wantsRows ? written : null, 201);
  }

  if (method === "PATCH") {
    const patch = parseBody(init) as Row;
    const touched: Row[] = [];
    for (const r of rows) {
      if (!matchesFilters(r, params)) continue;
      Object.assign(r, patch);
      touched.push(r);
    }
    persist();
    return wantsRows ? json(touched, 200) : json(null, 204);
  }

  if (method === "DELETE") {
    const removed = rows.filter((r) => matchesFilters(r, params));
    db[table] = rows.filter((r) => !matchesFilters(r, params));
    persist();
    return wantsRows ? json(removed, 200) : json(null, 204);
  }

  return json({ error: `Unsupported method ${method}` }, 405);
}

// A column, or a field inside a jsonb one: PostgREST writes those as
// "customer->>email" (text) and "customer->field" (json), and the app filters
// bookings by the customer's address that way.
function readColumn(row: Row, col: string): unknown {
  if (!col.includes("->")) return row[col];
  const [head, ...rest] = col.split(/->>?/);
  let cur: unknown = row[head];
  for (const key of rest) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

// Every non-directive query param is a column filter (col=op.value); a row must
// satisfy all of them.
function matchesFilters(row: Row, params: URLSearchParams): boolean {
  for (const [key, expr] of params.entries()) {
    if (RESERVED.has(key)) continue;
    if (!matchOne(row, key, expr)) return false;
  }
  return true;
}

function matchOne(row: Row, col: string, expr: string): boolean {
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  const cur = readColumn(row, col);
  switch (op) {
    case "eq":
      return String(cur) === val;
    case "is":
      if (val === "true") return cur === true;
      if (val === "false") return cur === false;
      if (val === "null") return cur == null;
      return false;
    case "cs": {
      // jsonb "contains": the row's array holds an element matching each wanted
      // object. Only used for "bookings whose items include this date".
      let want: unknown;
      try {
        want = JSON.parse(val);
      } catch {
        return false;
      }
      if (!Array.isArray(cur)) return false;
      const wants = Array.isArray(want) ? want : [want];
      return wants.every((w) => (cur as unknown[]).some((el) => contains(el, w)));
    }
    // Comparisons. Dates and times here are ISO strings, which compare
    // correctly as text — the same reason the rest of the app sorts them raw.
    case "gte":
      return String(cur) >= val;
    case "gt":
      return String(cur) > val;
    case "lte":
      return String(cur) <= val;
    case "lt":
      return String(cur) < val;
    case "neq":
      return String(cur) !== val;
    case "like":
    case "ilike": {
      // PostgREST wildcards are * in the query string, % in SQL; both appear.
      const pattern = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*").replace(/%/g, ".*");
      return new RegExp(`^${pattern}$`, op === "ilike" ? "i" : "").test(String(cur));
    }
    case "in": {
      // id=in.(a,b,c) — PostgREST's list membership, used when a screen holds
      // a set of ids and wants them all in one query.
      const list = val.replace(/^\(/, "").replace(/\)$/, "");
      return list
        .split(",")
        .map((v) => v.trim().replace(/^"|"$/g, ""))
        .includes(String(cur));
    }
    default:
      // An operator this store doesn't implement would otherwise match nothing,
      // which reads as "no rows" instead of "not supported" — the kind of
      // silence that makes local mode disagree with the database for no
      // visible reason.
      console.warn(`local-db: unsupported filter "${col}=${expr}" — treating as no match`);
      return false;
  }
}

// Postgres jsonb containment: `want` is contained in `el` (recursively for objects).
function contains(el: unknown, want: unknown): boolean {
  if (want && typeof want === "object" && !Array.isArray(want)) {
    if (!el || typeof el !== "object") return false;
    return Object.keys(want as Row).every((k) => contains((el as Row)[k], (want as Row)[k]));
  }
  return el === want;
}

// order=col.asc,col2.desc — stable multi-key sort.
function applyOrder(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const keys = order.split(",").map((s) => {
    const [col, dir] = s.split(".");
    return { col, desc: dir === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const { col, desc } of keys) {
      const av = a[col];
      const bv = b[col];
      if (av === bv) continue;
      const cmp =
        typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return desc ? -cmp : cmp;
    }
    return 0;
  });
}

function json(data: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  if (data === null) return new Response(null, { status });
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function preferHeader(init?: RequestInit): string {
  const h = init?.headers as Record<string, string> | undefined;
  if (!h) return "";
  for (const k of Object.keys(h)) if (k.toLowerCase() === "prefer") return h[k];
  return "";
}

function parseBody(init?: RequestInit): unknown {
  if (!init?.body || typeof init.body !== "string") return {};
  try {
    return JSON.parse(init.body);
  } catch {
    return {};
  }
}

// ---------- seed data ----------
// Rows are stored in Supabase (snake_case) shape, exactly as the data modules
// expect them, so nothing downstream needs to change. Edit freely — delete
// .local-data.json afterwards to re-seed.

function allWeek<T>(value: T): Record<string, T> {
  return Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, value]));
}

function isoDateFromToday(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function seed(): Store {
  const experiences: Row[] = [
    {
      id: "cipher-room",
      name: "The Cipher Room",
      location: "Downtown",
      tagline: "Crack the code before the clock runs out",
      description: "A codebreaker's den of locks, ciphers and hidden switches. Sharpen your wits and escape.",
      duration_minutes: 60,
      capacity: 8,
      price_cents: 3000,
      min_party: 4,
      max_party: 8,
      private: false,
      deposit_percent: 25,
      schedule_mode: "times",
      times: ["10:00", "12:00", "14:00", "16:00", "18:00"],
      interval_minutes: 75,
      windows: {},
      badge_bg: "#0b2540",
      badge_fg: "#ffffff",
      image_url: null,
      active: true,
      sort: 1,
    },
    {
      id: "blackwood-manor",
      name: "Blackwood Manor",
      location: "Riverside",
      tagline: "The house remembers everyone who enters",
      description: "A haunted Victorian estate. Uncover the family's secret and find your way out before midnight.",
      duration_minutes: 75,
      capacity: 6,
      price_cents: 3000,
      min_party: 4,
      max_party: 6,
      private: true,
      deposit_percent: 25,
      schedule_mode: "window",
      times: [],
      interval_minutes: 90,
      windows: allWeek({ first: "11:00", last: "19:00", closed: false }),
      badge_bg: "#3f2a56",
      badge_fg: "#ffffff",
      image_url: null,
      active: true,
      sort: 2,
    },
    {
      id: "prison-break",
      name: "Prison Break",
      location: "Downtown",
      tagline: "Sixty minutes to breach the wall",
      description: "You've been framed and thrown in Cell Block C. Pick the locks, bluff the guards and break free.",
      duration_minutes: 60,
      capacity: 10,
      price_cents: 3000,
      min_party: 4,
      max_party: 10,
      private: false,
      deposit_percent: 25,
      schedule_mode: "times",
      times: ["11:00", "13:30", "16:00", "19:00"],
      interval_minutes: 75,
      windows: {},
      badge_bg: "#7a1f1f",
      badge_fg: "#ffffff",
      image_url: null,
      active: true,
      sort: 3,
    },
  ];

  const demoBooking: Row = {
    id: randomUUID(),
    reference: "VB-DEMO01",
    created_at: nowISO(),
    customer: { firstName: "Alex", lastName: "Rivera", email: "alex@example.com", phone: "555-0100", subscribe: false },
    items: [
      {
        roomId: "cipher-room",
        roomName: "The Cipher Room",
        location: "Downtown",
        date: isoDateFromToday(3),
        time: "14:00",
        quantity: 4,
        priceCents: 3000,
        durationMinutes: 60,
        depositPercent: 25,
        badgeBg: "#0b2540",
        badgeFg: "#ffffff",
      },
    ],
    promo_code: null,
    payment_option: "full",
    pricing: { subtotalCents: 12000, discountCents: 0, gstCents: 600, totalCents: 12600, paidCents: 12600, balanceCents: 0 },
    source: "online",
    no_show: false,
  };

  return {
    experiences,
    bookings: [demoBooking],
    promo_codes: [{ code: "WELCOME10", percent_off: 10, active: true }],
    taxes: [{ id: "tax-gst", name: "GST", percent: 5, active: true, sort: 1 }],
    location_hours: [
      { location: "Downtown", hours: allWeek({ open: "09:00", close: "22:00", closed: false }) },
      { location: "Riverside", hours: allWeek({ open: "11:00", close: "20:00", closed: false }) },
    ],
    settings: [
      {
        key: "business_details",
        value: {
          companyName: "Voltris Escape Rooms",
          phone: "(555) 010-2040",
          cell: "",
          email: "hello@voltris.test",
          website: "https://voltris.test",
          taxLabel: "GST",
          taxNumber: "123456789",
        },
        updated_at: nowISO(),
      },
    ],
    staff_notes: [{ id: randomUUID(), note: "Front-door keypad code is 4821 this week.", created_at: nowISO() }],
    activity_log: [{ id: randomUUID(), action: "Booking created", detail: "VB-DEMO01 · The Cipher Room", created_at: nowISO() }],
  };
}
