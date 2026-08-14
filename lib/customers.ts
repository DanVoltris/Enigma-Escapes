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

export async function listManualCustomers(): Promise<ManualCustomer[]> {
  // email breaks ties: created_at alone is not unique (the old system
  // bulk-loaded hundreds of people on the same minute) and Postgres gives no
  // stable order within a tie, so rows shuffle between pages and some are
  // returned twice while others are never returned at all.
  const rows = await restAllPages<Row>(
    "customers?select=*&order=created_at.desc,email.desc",
    "Loading customers"
  );
  if (rows === null) return []; // table not created yet
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
