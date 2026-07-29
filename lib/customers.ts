// Manually added customers (no booking yet) — staff add them from the
// Customers tab. Keyed by email so re-adding someone updates instead of
// duplicating, and booking-derived rows naturally take over once they book.
// Supabase table (see CLAUDE.md): customers(email text primary key,
// first_name text, last_name text, phone text, subscribe boolean,
// created_at timestamptz).
import { rest, restError } from "./supabase";

export type ManualCustomer = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  subscribe: boolean;
  createdAt: string;
};

type Row = {
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  subscribe: boolean;
  created_at: string;
};

export async function listManualCustomers(): Promise<ManualCustomer[]> {
  const res = await rest("customers?select=*&order=created_at.desc");
  if (res.status === 404) return []; // table not created yet
  if (!res.ok) throw await restError(res, "Loading customers");
  return ((await res.json()) as Row[]).map((r) => ({
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone ?? "",
    subscribe: r.subscribe === true,
    createdAt: r.created_at,
  }));
}

// One row per email across bookings + manually added customers — the same
// merge the Customers tab shows (booking stats accumulate; newest booking
// wins the contact details). Used by the page and the CSV export.
export type CustomerRowData = {
  name: string;
  email: string;
  phone: string;
  subscribed: boolean;
  bookings: number;
  guests: number;
  spentCents: number;
  lastBooked: string;
};

export async function aggregateCustomers(
  bookings: { customer: { firstName: string; lastName: string; email: string; phone: string; subscribe: boolean }; createdAt: string; items: { quantity: number }[]; pricing: { paidCents: number } }[],
  manual: ManualCustomer[]
): Promise<CustomerRowData[]> {
  const byEmail = new Map<string, CustomerRowData>();
  for (const m of manual) {
    byEmail.set(m.email.toLowerCase(), {
      name: `${m.firstName} ${m.lastName}`,
      email: m.email,
      phone: m.phone,
      subscribed: m.subscribe,
      bookings: 0,
      guests: 0,
      spentCents: 0,
      lastBooked: m.createdAt,
    });
  }
  for (const b of bookings) {
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

export async function upsertManualCustomer(c: ManualCustomer): Promise<void> {
  const res = await rest("customers?on_conflict=email", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([
      {
        email: c.email,
        first_name: c.firstName,
        last_name: c.lastName,
        phone: c.phone,
        subscribe: c.subscribe,
        created_at: c.createdAt,
      },
    ]),
  });
  if (res.status === 404) throw new Error("The customers table doesn't exist yet — see CLAUDE.md for the SQL.");
  if (!res.ok) throw await restError(res, "Saving the customer");
}
