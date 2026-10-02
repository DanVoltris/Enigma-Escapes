// Who a campaign goes to.
//
// Pure, and shared with the composer in the browser: the manager picks these
// filters on screen and the server re-reads them from the same rules, so what
// was counted is what gets texted.

export type CampaignFilters = {
  // How recently they booked. 24 is the consent window; null is everyone ever,
  // which the portal warns about rather than hides.
  months: number | null;
  includeSubscribers: boolean;
  areaCodes: string[];
  locations: string[];
};

export const DEFAULT_FILTERS: CampaignFilters = {
  months: 24,
  includeSubscribers: true,
  areaCodes: [],
  locations: [],
};

// The consent window: someone who bought from you may be texted for this long
// afterwards without asking first.
export const CONSENT_MONTHS = 24;

export function normalizeFilters(raw: unknown): CampaignFilters {
  const o = (raw ?? {}) as Record<string, unknown>;
  const months =
    o.months === null || o.months === "" || o.months === undefined
      ? null
      : Number.isFinite(Number(o.months)) && Number(o.months) > 0
        ? Math.min(600, Math.round(Number(o.months)))
        : DEFAULT_FILTERS.months;
  const list = (v: unknown, clean: (s: string) => string): string[] =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string").map(clean).filter(Boolean))].slice(0, 40)
      : [];
  return {
    months,
    includeSubscribers: o.includeSubscribers !== false,
    areaCodes: list(o.areaCodes, (s) => s.replace(/\D/g, "").slice(0, 3)),
    locations: list(o.locations, (s) => s.trim().slice(0, 80)),
  };
}

