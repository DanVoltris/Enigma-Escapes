// Pure option data + normaliser for locale settings. No side-effecting imports,
// so it's safe in both the client form and the server API. Timezone and
// currency lists come from the JS runtime (Intl) so every region on earth is
// covered, with small fallbacks for old engines.
import { DEFAULT_LOCALE, type LocaleConfig } from "./format";

export type Opt = { value: string; label: string };

export const LANGUAGES: Opt[] = [{ value: "en-CA", label: "English (Canada)" }];

export const DATE_STYLES: Opt[] = [
  { value: "medium", label: "Jul 24, 2026 (medium)" },
  { value: "dmy", label: "24/07/2026 (day/month/year)" },
  { value: "mdy", label: "07/24/2026 (month/day/year)" },
  { value: "ymd", label: "2026-07-24 (ISO)" },
];

export const TIME_FORMATS: Opt[] = [
  { value: "12", label: "1:00 PM (12-hour)" },
  { value: "24", label: "13:00 (24-hour)" },
];

export const FIRST_DAYS: Opt[] = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
];

const FALLBACK_TZ = ["America/Winnipeg", "America/New_York", "Europe/London", "UTC"];
const FALLBACK_CCY = ["CAD", "USD", "GBP", "EUR", "AUD"];

function supported(kind: "timeZone" | "currency", fallback: string[]): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const vals = fn?.(kind);
    return vals && vals.length ? vals : fallback;
  } catch {
    return fallback;
  }
}

// Every IANA timezone the runtime knows (~400+), e.g. Europe/Moscow, Asia/Tokyo,
// Australia/Sydney, Africa/Lagos.
export function timezoneOptions(): Opt[] {
  return supported("timeZone", FALLBACK_TZ).map((tz) => ({ value: tz, label: tz.replace(/_/g, " ") }));
}

// The narrow symbol for a currency in a given locale ("$", "£", "₽", "¥"), or "".
export function currencySymbolOf(code: string, locale = "en"): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? "";
  } catch {
    return "";
  }
}

// Every ISO 4217 currency the runtime knows (~160), labelled with name + symbol.
export function currencyOptions(): Opt[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {
    names = null;
  }
  return supported("currency", FALLBACK_CCY).map((code) => {
    const sym = currencySymbolOf(code);
    const name = names?.of(code) ?? code;
    return { value: code, label: `${code}${sym && sym !== code ? ` (${sym})` : ""} — ${name}` };
  });
}

function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidCurrency(code: unknown): code is string {
  if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

// Coerce arbitrary input into a valid LocaleConfig, falling back to defaults for
// anything unrecognised. Used by both getLocale (read) and the save API.
export function normalizeLocale(input: unknown): LocaleConfig {
  const o = (input ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

  const currencyCode = isValidCurrency(o.currencyCode) ? o.currencyCode : DEFAULT_LOCALE.currencyCode;

  return {
    language: pick(o.language, LANGUAGES.map((l) => l.value), DEFAULT_LOCALE.language),
    currencyCode,
    currencySymbol: currencySymbolOf(currencyCode) || DEFAULT_LOCALE.currencySymbol,
    timezone: isValidTimezone(o.timezone) ? o.timezone : DEFAULT_LOCALE.timezone,
    dateStyle: pick(o.dateStyle, ["medium", "dmy", "mdy", "ymd"] as const, DEFAULT_LOCALE.dateStyle),
    timeFormat: pick(o.timeFormat, ["12", "24"] as const, DEFAULT_LOCALE.timeFormat),
    firstDay: String(o.firstDay) === "1" ? 1 : 0,
  };
}
