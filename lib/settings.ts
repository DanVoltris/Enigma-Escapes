import { DEFAULT_INTEGRATIONS, normalizeIntegrations, type IntegrationSettings } from "./integrations";
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
  // Everyone who should be texted the moment a booking request lands. A
  // request is only for a session starting within the next few hours, so
  // nobody sees it unless they happen to have the Requests tab open.
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

// ---------- booking policies ----------
// The reschedule/cancellation policy text a venue shows customers. These are
// DISPLAY policies (rendered on the confirmation page) — not self-service
// controls, since the app has no customer accounts to reschedule/cancel from.

export type PolicyUnit = "days" | "weeks" | "months";

export type BookingPolicy = {
  show: boolean; // show on the customer confirmation page
  cutoffValue: number; // "up to N …"
  cutoffUnit: PolicyUnit;
  title: string;
  content: string;
};

export type BookingPolicies = {
  reschedule: BookingPolicy;
  cancellation: BookingPolicy;
};

export const DEFAULT_POLICIES: BookingPolicies = {
  reschedule: {
    show: false,
    cutoffValue: 1,
    cutoffUnit: "months",
    title: "Our policy on rescheduling bookings",
    content: "Feel free to change your booking online or give us a call and we will find a new time for you.",
  },
  cancellation: {
    show: false,
    cutoffValue: 1,
    cutoffUnit: "weeks",
    title: "Our policy on cancelling bookings",
    content: "Need to cancel? Get in touch and we will sort out your refund according to our cancellation terms.",
  },
};

function normalizePolicy(input: unknown, def: BookingPolicy): BookingPolicy {
  const o = (input ?? {}) as Record<string, unknown>;
  const unit: PolicyUnit =
    o.cutoffUnit === "days" || o.cutoffUnit === "weeks" || o.cutoffUnit === "months" ? o.cutoffUnit : def.cutoffUnit;
  const value =
    Number.isInteger(o.cutoffValue) && (o.cutoffValue as number) > 0 && (o.cutoffValue as number) <= 365
      ? (o.cutoffValue as number)
      : def.cutoffValue;
  return {
    show: typeof o.show === "boolean" ? o.show : def.show,
    cutoffValue: value,
    cutoffUnit: unit,
    title: typeof o.title === "string" ? o.title.trim().slice(0, 120) : def.title,
    content: typeof o.content === "string" ? o.content.slice(0, 2000) : def.content,
  };
}

export function normalizePolicies(input: unknown): BookingPolicies {
  const o = (input ?? {}) as Record<string, unknown>;
  return {
    reschedule: normalizePolicy(o.reschedule, DEFAULT_POLICIES.reschedule),
    cancellation: normalizePolicy(o.cancellation, DEFAULT_POLICIES.cancellation),
  };
}

// Never throws — the confirmation page and settings form both tolerate a missing
// table/row by falling back to defaults.
export async function getBookingPolicies(): Promise<BookingPolicies> {
  try {
    const { value } = await getSetting<Partial<BookingPolicies>>("booking_policies");
    return normalizePolicies(value);
  } catch {
    return DEFAULT_POLICIES;
  }
}

// ---------- marketing integrations ----------

// Never throws — the customer site must render even if settings are unreachable.
export async function getIntegrations(): Promise<IntegrationSettings> {
  try {
    const { value } = await getSetting<Partial<IntegrationSettings>>("integrations");
    return normalizeIntegrations(value);
  } catch {
    return DEFAULT_INTEGRATIONS;
  }
}
