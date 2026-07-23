// Pure option data + normaliser for locale settings. No imports with side
// effects, so it's safe in both the client form and the server API.
import { DEFAULT_LOCALE, type LocaleConfig } from "./format";

export const LANGUAGES = [{ value: "en-CA", label: "English (Canada)" }];

// value = "CODE|SYMBOL" so one control carries both.
export const CURRENCIES = [
  { value: "CAD|$", label: "Canadian Dollar (CAD, $)" },
  { value: "USD|$", label: "US Dollar (USD, $)" },
  { value: "GBP|£", label: "British Pound (GBP, £)" },
  { value: "EUR|€", label: "Euro (EUR, €)" },
  { value: "AUD|$", label: "Australian Dollar (AUD, $)" },
];

export const TIMEZONES = [
  "America/Winnipeg",
  "America/Toronto",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Edmonton",
  "America/Vancouver",
  "America/Los_Angeles",
  "Europe/London",
  "UTC",
].map((tz) => ({ value: tz, label: tz.replace("_", " ") }));

export const DATE_STYLES = [
  { value: "medium", label: "Jul 24, 2026 (medium)" },
  { value: "dmy", label: "24/07/2026 (day/month/year)" },
  { value: "mdy", label: "07/24/2026 (month/day/year)" },
  { value: "ymd", label: "2026-07-24 (ISO)" },
];

export const TIME_FORMATS = [
  { value: "12", label: "1:00 PM (12-hour)" },
  { value: "24", label: "13:00 (24-hour)" },
];

export const FIRST_DAYS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
];

export const DECIMALS = [
  { value: ".", label: "1,234.56" },
  { value: ",", label: "1.234,56" },
];

// Coerce arbitrary input into a valid LocaleConfig, falling back to defaults
// for anything unrecognised. Used by both getLocale (read) and the save API.
export function normalizeLocale(input: unknown): LocaleConfig {
  const o = (input ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

  const currencyValue = pick(
    o.currencyCode && o.currencySymbol ? `${o.currencyCode}|${o.currencySymbol}` : "",
    CURRENCIES.map((c) => c.value),
    `${DEFAULT_LOCALE.currencyCode}|${DEFAULT_LOCALE.currencySymbol}`
  );
  const [currencyCode, currencySymbol] = currencyValue.split("|");

  return {
    language: pick(o.language, LANGUAGES.map((l) => l.value), DEFAULT_LOCALE.language),
    currencyCode,
    currencySymbol,
    timezone: pick(o.timezone, TIMEZONES.map((t) => t.value), DEFAULT_LOCALE.timezone),
    dateStyle: pick(o.dateStyle, ["medium", "dmy", "mdy", "ymd"] as const, DEFAULT_LOCALE.dateStyle),
    timeFormat: pick(o.timeFormat, ["12", "24"] as const, DEFAULT_LOCALE.timeFormat),
    firstDay: pick(String(o.firstDay), ["0", "1"] as const, String(DEFAULT_LOCALE.firstDay) as "0" | "1") === "1" ? 1 : 0,
    decimal: pick(o.decimal, [".", ","] as const, DEFAULT_LOCALE.decimal),
  };
}
