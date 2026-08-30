// Locale/formatting config. It's a BUSINESS-WIDE setting (identical for every
// visitor), so it's safe to hold as a primed singleton: the root layout reads
// it from the DB and primes both the server module (below) and the browser
// (window.__LOCALE__ via an inline script). Formatters read whichever applies.

export type DateStyle = "medium" | "dmy" | "mdy" | "ymd";
export type TimeFormat = "12" | "24";

export type LocaleConfig = {
  language: string; // BCP-47 tag used for Intl (display only; UI copy stays English)
  currencyCode: string; // ISO 4217, e.g. "CAD", "GBP", "JPY"
  currencySymbol: string; // fallback symbol if Intl currency formatting fails
  timezone: string; // IANA, e.g. "America/Winnipeg"
  dateStyle: DateStyle;
  timeFormat: TimeFormat;
  firstDay: 0 | 1; // 0 = Sunday, 1 = Monday
};

export const DEFAULT_LOCALE: LocaleConfig = {
  language: "en-CA",
  currencyCode: "CAD",
  currencySymbol: "$",
  timezone: "America/Winnipeg",
  dateStyle: "medium",
  timeFormat: "12",
  firstDay: 0,
};

declare global {
  // eslint-disable-next-line no-var
  var __LOCALE__: LocaleConfig | undefined;
}

let activeLocale: LocaleConfig = DEFAULT_LOCALE;

// Called on the server (root layout) so server components format with the
// business's chosen locale. Same value for every request — no request bleed.
export function primeLocale(config: LocaleConfig): void {
  activeLocale = config;
}

// The config in force right now — the browser value if present (set by the
// root layout's inline script before hydration), otherwise the server module.
export function localeConfig(): LocaleConfig {
  if (typeof window !== "undefined" && window.__LOCALE__) return window.__LOCALE__;
  return activeLocale;
}

export function formatMoney(cents: number): string {
  const c = localeConfig();
  // Intl handles the symbol, its placement, grouping and each currency's own
  // decimal count (e.g. JPY shows none) for any ISO currency worldwide.
  try {
    return new Intl.NumberFormat(c.language, {
      style: "currency",
      currency: c.currencyCode,
      currencyDisplay: "narrowSymbol",
    }).format(cents / 100);
  } catch {
    return `${c.currencySymbol}${(cents / 100).toFixed(2)}`;
  }
}

// "13:00" -> "1:00 PM" (12-hour) or "13:00" (24-hour), per the locale.
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (localeConfig().timeFormat === "24") {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// Parse "YYYY-MM-DD" as a local date (avoids the UTC shift of new Date(string)).
export function parseISODate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Back-compat export (the current default timezone). Live code should read
// localeConfig().timezone so a Settings change takes effect.
export const BUSINESS_TIMEZONE = DEFAULT_LOCALE.timezone;

function nowPartsInBusinessTZ(): { y: string; m: string; d: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: localeConfig().timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), hour: Number(get("hour")), minute: Number(get("minute")) };
}

export function todayISO(): string {
  const { y, m, d } = nowPartsInBusinessTZ();
  return `${y}-${m}-${d}`;
}

// Minutes since midnight in the venue's timezone — used to hide start times
// that have already passed today.
export function nowMinutesInBusinessTZ(): number {
  const { hour, minute } = nowPartsInBusinessTZ();
  return hour * 60 + minute;
}

// Bookings starting within this window aren't self-serve — they go through a
// manager-approved request instead (the Requests tab).
export const REQUEST_WINDOW_MINUTES = 4 * 60;

// Venue-local minutes from now until a slot starts (negative = already started).
export function minutesUntilSlot(date: string, time: string): number {
  const dayDiff = Math.round((parseISODate(date).getTime() - parseISODate(todayISO()).getTime()) / 86_400_000);
  const [h, m] = time.split(":").map(Number);
  return dayDiff * 1440 + h * 60 + m - nowMinutesInBusinessTZ();
}

// The venue-local calendar date of an ISO timestamp, e.g. "2026-07-20".
export function businessDateOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: localeConfig().timezone }).format(new Date(iso));
}

// The venue-local weekday name of an ISO timestamp, e.g. "Monday".
export function businessWeekdayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: localeConfig().timezone, weekday: "long" }).format(new Date(iso));
}

// A timestamp as venue-local date and time, e.g. "Aug 30, 2026, 5:34 a.m.".
// Never the machine's own clock: the server renders in UTC on Vercel, and
// staff read the portal from anywhere — the venue's timezone is the one truth.
export function formatTimestamp(iso: string | Date): string {
  const c = localeConfig();
  return new Date(iso).toLocaleString(c.language, {
    timeZone: c.timezone,
    dateStyle: "medium",
    timeStyle: "short",
    hour12: c.timeFormat === "12",
  });
}

// Venue-local date of a timestamp, e.g. "Aug 30, 2026".
export function formatTimestampDate(iso: string | Date): string {
  const c = localeConfig();
  return new Date(iso).toLocaleDateString(c.language, { timeZone: c.timezone, dateStyle: "medium" });
}

// Venue-local time of a timestamp, e.g. "5:34 a.m.".
export function formatTimestampTime(iso: string | Date): string {
  const c = localeConfig();
  return new Date(iso).toLocaleTimeString(c.language, {
    timeZone: c.timezone,
    timeStyle: "short",
    hour12: c.timeFormat === "12",
  });
}

export function addDaysISO(date: string, days: number): string {
  const d = parseISODate(date);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "2026-07-24" -> "Fri 24 Jul 2026" (medium), or a numeric style per the locale.
export function formatDateLong(date: string): string {
  const c = localeConfig();
  const [y, m, d] = date.split("-");
  if (c.dateStyle === "dmy") return `${d}/${m}/${y}`;
  if (c.dateStyle === "mdy") return `${m}/${d}/${y}`;
  if (c.dateStyle === "ymd") return `${y}-${m}-${d}`;
  return parseISODate(date).toLocaleDateString(c.language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Parts for the date badge on the booking panel: FRI / 24 / JUL
export function dateBadgeParts(date: string): { weekday: string; day: number; month: string } {
  const d = parseISODate(date);
  const lang = localeConfig().language;
  return {
    weekday: d.toLocaleDateString(lang, { weekday: "short" }).toUpperCase(),
    day: d.getDate(),
    month: d.toLocaleDateString(lang, { month: "short" }).toUpperCase(),
  };
}

export function isValidISODate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = parseISODate(date);
  return !Number.isNaN(d.getTime());
}
