// Where a booking came from. On first visit the browser stashes any utm_*
// parameters, the referrer's host and the landing path in a cookie
// (components/VisitorId); at checkout the server reads it, validates it, and
// stamps it on the booking. First touch, not last: the post that brought them
// in gets the credit, even if they came back later by typing the address.
//
// No server imports here, so the client component can share the cookie name
// and the validator without pulling Supabase into the browser bundle.
import type { Attribution, Booking } from "./types";

export const ATTRIBUTION_COOKIE = "vb_attr";
export const ATTRIBUTION_DAYS = 90;

const TEXT_KEYS = ["source", "medium", "campaign", "content", "term", "landing"] as const;
const MAX = 120;

function text(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, MAX);
  return t ? t : undefined;
}

// Only a bare hostname is kept from the referrer — never a full URL, which can
// carry someone else's query string.
function host(v: unknown): string | undefined {
  const t = text(v);
  if (!t) return undefined;
  const h = t.toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  return /^[a-z0-9.-]{1,120}$/.test(h) ? h : undefined;
}

// Accepts only the fields we mean to keep, each cut to size. Anything else in
// the cookie — including anything an attacker put there — is dropped.
export function parseAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: Attribution = {};
  for (const k of TEXT_KEYS) {
    const v = text(o[k]);
    if (v) out[k] = v;
  }
  const referrer = host(o.referrer);
  if (referrer) out.referrer = referrer;
  const at = text(o.at);
  if (at && !Number.isNaN(Date.parse(at))) out.at = at;
  return Object.keys(out).length ? out : null;
}

export function attributionFromCookie(value: string | undefined): Attribution | null {
  if (!value) return null;
  try {
    return parseAttribution(JSON.parse(decodeURIComponent(value)));
  } catch {
    return null;
  }
}

// --- Reporting ------------------------------------------------------------------

export type SourceRow = { label: string; bookings: number; totalCents: number };
export type AttributionBreakdown = {
  bySource: SourceRow[]; // "source / medium", plus Direct and Walk-in lines
  byCampaign: SourceRow[]; // only bookings that carried a campaign
  attributed: number; // online bookings with any attribution at all
  online: number;
  walkIns: number;
};

// Website bookings by where they came from. A website booking with no cookie
// data is Direct — typed the address, a bookmark, or a browser that dropped
// the cookie. Desk bookings have no attribution by definition and sit on their
// own line so the online split stays honest.
export function attributionBreakdown(purchased: Booking[]): AttributionBreakdown {
  const sources = new Map<string, SourceRow>();
  const campaigns = new Map<string, SourceRow>();
  const add = (map: Map<string, SourceRow>, label: string, b: Booking) => {
    const row = map.get(label) ?? { label, bookings: 0, totalCents: 0 };
    row.bookings++;
    row.totalCents += b.pricing.totalCents;
    map.set(label, row);
  };
  let attributed = 0;
  let online = 0;
  let walkIns = 0;
  for (const b of purchased) {
    if (b.source === "in_person") {
      walkIns++;
      add(sources, "Walk-in (desk)", b);
      continue;
    }
    online++;
    const a = b.attribution;
    if (!a) {
      add(sources, "Direct", b);
      continue;
    }
    attributed++;
    const source = a.source ?? a.referrer ?? "Direct";
    add(sources, a.medium ? `${source} / ${a.medium}` : source, b);
    if (a.campaign) add(campaigns, a.campaign, b);
  }
  const byBookings = (x: SourceRow, y: SourceRow) => y.bookings - x.bookings;
  return {
    bySource: Array.from(sources.values()).sort(byBookings),
    byCampaign: Array.from(campaigns.values()).sort(byBookings),
    attributed,
    online,
    walkIns,
  };
}
