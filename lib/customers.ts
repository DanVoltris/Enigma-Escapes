// Manually added customers (no booking yet) — staff add them from the
// Customers tab. Keyed by email so re-adding someone updates instead of
// duplicating, and booking-derived rows naturally take over once they book.
// Supabase table (see CLAUDE.md): customers(email text primary key,
// first_name text, last_name text, phone text, subscribe boolean,
// created_at timestamptz).
import { rest, restAllPages, restError } from "./supabase";

// History carried over from the old booking system (scripts/import-customers.mjs).
// Every field is optional: it's jsonb written from a CSV whose columns have
// already changed once between exports, so nothing here is guaranteed.
export type ImportedHistory = {
  source?: string | null;
  legacyId?: string | null;
  joinedAt?: string | null;
  altPhone?: string | null;
  dob?: string | null;
  transactions?: number;
  bookings?: number;
  bookingValueCents?: number;
  paidCents?: number;
  unpaidCents?: number;
  overpaidCents?: number;
  creditCents?: number;
  creditRemainingCents?: number;
  vouchers?: number;
  voucherValueCents?: number;
  waiver?: string | null;
  lastAttended?: string | null;
  lastItem?: string | null;
  mergedFrom?: string[];
};

export type ManualCustomer = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  subscribe: boolean;
  createdAt: string;
  imported: ImportedHistory | null;
};

type Row = {
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  subscribe: boolean;
  created_at: string;
  imported: ImportedHistory | null;
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// The imported-history blob is by far the heaviest column — carrying it makes a
// page of the roster four times slower to fetch — and the Customers list only
// needs two numbers out of it to show a total. `history: false` fetches just
// those, for callers that will pull the full record for the handful of rows
// they actually display (see importedHistoryFor). Everything that genuinely
// needs the whole blob for everyone, like the CSV export, leaves it alone.
const FULL_SELECT = "*";
const LIGHT_SELECT =
  "email,first_name,last_name,phone,subscribe,created_at," +
  "legacy_bookings:imported->>bookings,legacy_paid:imported->>paidCents";

export async function listManualCustomers(opts?: { history?: boolean }): Promise<ManualCustomer[]> {
  const light = opts?.history === false;
  // email breaks ties: created_at alone is not unique (the old system
  // bulk-loaded hundreds of people on the same minute) and Postgres gives no
  // stable order within a tie, so rows shuffle between pages and some are
  // returned twice while others are never returned at all.
  const rows = await restAllPages<Row & { legacy_bookings?: string; legacy_paid?: string }>(
    `customers?select=${light ? LIGHT_SELECT : FULL_SELECT}&order=created_at.desc,email.desc`,
    "Loading customers"
  );
  if (rows === null) return []; // table not created yet
  if (light) {
    return rows.map((r) => {
      const bookings = Number(r.legacy_bookings ?? 0) || 0;
      const paidCents = Number(r.legacy_paid ?? 0) || 0;
      return {
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        phone: r.phone ?? "",
        subscribe: r.subscribe === true,
        createdAt: r.created_at,
        // Partial on purpose: only the fields the totals are built from. The
        // rows that get rendered have the real thing filled in afterwards.
        imported: bookings || paidCents ? { bookings, paidCents } : null,
      };
    });
  }
  return rows.map((r) => ({
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone ?? "",
    subscribe: r.subscribe === true,
    createdAt: r.created_at,
    imported: r.imported && typeof r.imported === "object" ? r.imported : null,
  }));
}

// One row per email across bookings + manually added customers — the same
// merge the Customers tab shows (booking stats accumulate; newest booking
// wins the contact details). Used by the page and the CSV export.
// Bookings/guests/spent are lifetime figures: anything imported from the old
// system plus everything booked here. `imported` is kept alongside so the
// Customers tab can show where the numbers came from.
// Bookings carried over from the old system (scripts/import-bookings.mjs) are
// referenced "VB-L<transaction>"; a booking made here is always "VB-" plus hex,
// so the L is unambiguous.
export function isImportedBooking(reference: string): boolean {
  return /^VB-L\d+$/i.test(reference);
}

// The old system's per-customer totals cover every session it ever sold them —
// including the ones now itemised as imported bookings. Counting both would
// show a customer's history twice, so the legacy figures are reduced by
// whatever has been itemised. Its export counted one "booking" per session,
// which is what an imported booking's items are.
function legacyRemainder(
  imported: ImportedHistory | null | undefined,
  itemised: { sessions: number; paidCents: number }
): { bookings: number; paidCents: number } {
  return {
    bookings: Math.max(0, num(imported?.bookings) - itemised.sessions),
    paidCents: Math.max(0, num(imported?.paidCents) - itemised.paidCents),
  };
}

// What a customer's imported bookings already account for.
export function itemisedLegacy(
  bookings: { reference: string; items: { quantity: number }[]; pricing: { paidCents: number } }[]
): { sessions: number; paidCents: number } {
  return bookings.reduce(
    (acc, b) => {
      if (!isImportedBooking(b.reference)) return acc;
      acc.sessions += b.items.length;
      acc.paidCents += b.pricing.paidCents;
      return acc;
    },
    { sessions: 0, paidCents: 0 }
  );
}

export type CustomerRowData = {
  name: string;
  email: string;
  phone: string;
  subscribed: boolean;
  bookings: number;
  guests: number;
  spentCents: number;
  lastBooked: string;
  imported: ImportedHistory | null;
};

export async function aggregateCustomers(
  bookings: { reference: string; customer: { firstName: string; lastName: string; email: string; phone: string; subscribe: boolean }; createdAt: string; items: { quantity: number }[]; pricing: { paidCents: number } }[],
  manual: ManualCustomer[]
): Promise<CustomerRowData[]> {
  // Walk-ins imported from the old system were filed under stand-in accounts
  // and arrive with no email. They aren't people to group by, and this list is
  // grouped by email, so they're left out of it.
  const named = bookings.filter((b) => b.customer.email.trim() !== "");

  const itemised = new Map<string, { sessions: number; paidCents: number }>();
  for (const b of named) {
    if (!isImportedBooking(b.reference)) continue;
    const key = b.customer.email.toLowerCase();
    const entry = itemised.get(key) ?? { sessions: 0, paidCents: 0 };
    entry.sessions += b.items.length;
    entry.paidCents += b.pricing.paidCents;
    itemised.set(key, entry);
  }

  const byEmail = new Map<string, CustomerRowData>();
  for (const m of manual) {
    const key = m.email.toLowerCase();
    // Imported people start on whatever of their old-system totals isn't
    // itemised as a booking already; bookings are added on top by the loop
    // below.
    const legacy = legacyRemainder(m.imported, itemised.get(key) ?? { sessions: 0, paidCents: 0 });
    byEmail.set(key, {
      name: `${m.firstName} ${m.lastName}`,
      email: m.email,
      phone: m.phone,
      subscribed: m.subscribe,
      bookings: legacy.bookings,
      guests: 0, // the old export never recorded party sizes
      spentCents: legacy.paidCents,
      lastBooked: m.createdAt,
      imported: m.imported,
    });
  }
  for (const b of named) {
    const key = b.customer.email.toLowerCase();
    const row = byEmail.get(key) ?? {
      name: `${b.customer.firstName} ${b.customer.lastName}`,
      email: b.customer.email,
      phone: b.customer.phone,
      subscribed: b.customer.subscribe,
      bookings: 0,
      guests: 0,
      spentCents: 0,
      lastBooked: b.createdAt,
      imported: null,
    };
    row.bookings += 1;
    row.guests += b.items.reduce((s, i) => s + i.quantity, 0);
    row.spentCents += b.pricing.paidCents;
    if (b.createdAt >= row.lastBooked) {
      row.lastBooked = b.createdAt;
      row.name = `${b.customer.firstName} ${b.customer.lastName}`;
      row.phone = b.customer.phone;
      row.subscribed = b.customer.subscribe;
    }
    byEmail.set(key, row);
  }
  return Array.from(byEmail.values()).sort((a, b) => b.lastBooked.localeCompare(a.lastBooked));
}

// One page of the Customers tab, computed by the customer_roster function in
// Postgres (scripts/customer-roster.sql) — search, merge, legacy netting, sort
// and slice all happen where the data lives, so the page asks for 100 people
// instead of building all 44k in memory. Returns null when the function isn't
// installed (or in local-data mode), and the caller falls back to
// aggregateCustomers over the full roster.
export type RosterPage = { total: number; rows: CustomerRowData[] };

export async function customerRosterPage(opts: {
  q?: string;
  subscribersOnly?: boolean;
  locations?: string[] | null;
  limit: number;
  offset: number;
}): Promise<RosterPage | null> {
  let res: Response;
  try {
    res = await rest("rpc/customer_roster", {
      method: "POST",
      body: JSON.stringify({
        p_q: opts.q || null,
        p_subscribers_only: opts.subscribersOnly === true,
        p_locations: opts.locations?.length ? opts.locations : null,
        p_limit: opts.limit,
        p_offset: opts.offset,
      }),
    });
  } catch {
    return null; // local-data mode has no rpc endpoint
  }
  if (res.status === 404) return null; // function not installed yet
  if (!res.ok) throw await restError(res, "Loading the customer roster");
  const rows = (await res.json()) as {
    total_rows: number;
    name: string;
    email: string;
    phone: string;
    subscribed: boolean;
    bookings: number;
    guests: number;
    spent_cents: number;
    last_booked: string;
    has_imported: boolean;
  }[];
  return {
    total: rows[0] ? Number(rows[0].total_rows) : 0,
    rows: rows.map((r) => ({
      name: r.name.trim(),
      email: r.email,
      phone: r.phone,
      subscribed: r.subscribed,
      bookings: r.bookings,
      guests: r.guests,
      spentCents: Number(r.spent_cents),
      lastBooked: r.last_booked,
      // A stand-in so "has legacy history" renders; the page swaps in the real
      // record via importedHistoryFor for the rows it shows.
      imported: r.has_imported ? {} : null,
    })),
  };
}

// The full imported history for a specific handful of people, keyed by
// lowercased email. Pairs with listManualCustomers({ history: false }): fetch
// the roster light, then fill in the real record for the rows being shown.
export async function importedHistoryFor(
  emails: string[]
): Promise<Map<string, ImportedHistory>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, ImportedHistory>();
  if (!wanted.length) return out;
  // Chunked so a long list can't outgrow what fits in a URL.
  for (let i = 0; i < wanted.length; i += 200) {
    const list = wanted.slice(i, i + 200).map((e) => `"${e.replace(/"/g, '\\"')}"`).join(",");
    const res = await rest(
      `customers?select=email,imported&email=in.(${encodeURIComponent(list)})`
    );
    if (res.status === 404) return out; // table not created yet
    if (!res.ok) throw await restError(res, "Loading customer history");
    for (const row of (await res.json()) as { email: string; imported: ImportedHistory | null }[]) {
      if (row.imported && typeof row.imported === "object") {
        out.set(row.email.toLowerCase(), row.imported);
      }
    }
  }
  return out;
}

// One person's stored record, with their full imported history — for the
// profile page, which has no business loading all 44k people to find them.
export async function getManualCustomer(email: string): Promise<ManualCustomer | null> {
  const res = await rest(`customers?email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`);
  if (res.status === 404) return null; // table not created yet
  if (!res.ok) throw await restError(res, "Loading the customer");
  const [r] = (await res.json()) as Row[];
  if (!r) return null;
  return {
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone ?? "",
    subscribe: r.subscribe === true,
    createdAt: r.created_at,
    imported: r.imported && typeof r.imported === "object" ? r.imported : null,
  };
}

// Used by the merge tool: the merged-away email's manual entry (if any) goes.
export async function deleteManualCustomer(email: string): Promise<void> {
  const res = await rest(`customers?email=eq.${encodeURIComponent(email.toLowerCase())}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok && res.status !== 404) throw await restError(res, "Removing the old customer entry");
}

export async function upsertManualCustomer(c: ManualCustomer): Promise<void> {
  const res = await rest("customers?on_conflict=email", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([
      {
        // Lowercased to match how every reader here looks the row up.
        email: c.email.toLowerCase(),
        first_name: c.firstName,
        last_name: c.lastName,
        phone: c.phone,
        subscribe: c.subscribe,
        created_at: c.createdAt,
        // Left out entirely when there's nothing to say: an upsert only touches
        // the columns it names, so re-adding someone by hand keeps whatever
        // history the import gave them.
        ...(c.imported ? { imported: c.imported } : {}),
      },
    ]),
  });
  if (res.status === 404) throw new Error("The customers table doesn't exist yet — see CLAUDE.md for the SQL.");
  if (!res.ok) throw await restError(res, "Saving the customer");
}
