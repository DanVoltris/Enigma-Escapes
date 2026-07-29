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
