import { rest, restError } from "./supabase";

// Key-value app settings stored in the `settings` table (key text primary key,
// value jsonb). The table may not exist yet — creating tables needs the
// Supabase dashboard — so reads report that instead of throwing, and pages
// show setup instructions.

export const SETTINGS_TABLE_SQL = `create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table settings enable row level security;`;

export type BusinessDetails = {
  companyName: string;
  phone: string;
  cell: string;
  email: string;
  website: string;
  taxLabel: string; // e.g. "GST (Goods and Services Tax)"
  taxNumber: string;
};

type SettingResult<T> = { tableMissing: boolean; value: T | null };

export async function getSetting<T>(key: string): Promise<SettingResult<T>> {
  const res = await rest(`settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`);
  if (res.status === 404) return { tableMissing: true, value: null }; // table not created yet
  if (!res.ok) throw await restError(res, "Loading settings");
  const rows = (await res.json()) as { value: T }[];
  return { tableMissing: false, value: rows[0]?.value ?? null };
}

// Upsert one setting. Throws a friendly error when the table doesn't exist.
export async function saveSetting(key: string, value: unknown): Promise<void> {
  const res = await rest("settings?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  });
  if (res.status === 404) {
    throw new Error("The settings table doesn't exist yet. Run the SQL on the Business details page first.");
  }
  if (!res.ok) throw await restError(res, "Saving settings");
}

export async function getBusinessDetails(): Promise<SettingResult<BusinessDetails>> {
  return getSetting<BusinessDetails>("business_details");
}
