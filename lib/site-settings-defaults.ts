// Pure (database-free) shape, defaults and validation for the customer
// booking-site settings. Kept separate from site-settings.ts — which loads them
// from the database — so client components (e.g. lib/site-config.tsx) can import
// the type and defaults without pulling server-only data code into the browser
// bundle.
import { REQUEST_WINDOW_MINUTES } from "./format";
import { BOOKING_WINDOW_DAYS, HOLD_MINUTES } from "./pricing";

export type SiteSettings = {
  // availability
  windowDays: number; // how far ahead customers can book
  // A session starting within this many minutes can't be booked straight from
  // the site: the customer sends a request and staff confirm it. 0 turns that
  // off, so sessions stay self-serve right up to their start time.
  requestWindowMinutes: number;
  // More notice for sessions EARLY in the day, on chosen weekdays — the shift
  // that runs thin until the evening crew arrives. Sessions starting at or
  // before `untilTime` on those days need `minutes` of notice instead of the
  // window above; everything else uses the window above. null = same rule all
  // day, every day.
  earlyRequestWindow: {
    minutes: number;
    untilTime: string; // "HH:MM", inclusive
    days: number[]; // 0 = Sunday … 6 = Saturday
  } | null;
  availableLabel: string; // CTA on a bookable slot
  soldOutLabel: string; // label on a full slot
  // colours (customer site only)
  brandColor: string; // accent used for highlights
  buttonBg: string;
  buttonText: string;
  logoUrl: string | null; // shown in the site header instead of the text brand
  // Square picture for the staff app on a phone's home screen and on its
  // notifications (lib/venue-icon.tsx). Without one the logo is used, and
  // without that the venue's initial.
  appIconUrl: string | null;
  // shopping basket
  holdMinutes: number; // how long a cart holds its slots
  basketExpiredText: string;
  // content
  introHeading: string;
  introText: string;
  supportText: string;
  // header links — per venue, so one can drop a link the other keeps
  showHomeLink: boolean; // "Back to home" (points at this booking page)
  showGiftVouchers: boolean; // the gift voucher shop
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  windowDays: BOOKING_WINDOW_DAYS,
  requestWindowMinutes: REQUEST_WINDOW_MINUTES,
  earlyRequestWindow: null,
  availableLabel: "Book now",
  soldOutLabel: "Sold out",
  brandColor: "#87cefa",
  buttonBg: "#87cefa",
  buttonText: "#0b2540",
  logoUrl: null,
  appIconUrl: null,
  holdMinutes: HOLD_MINUTES,
  basketExpiredText:
    "You are out of time. Your held slots have been released — please pick your times again to continue.",
  introHeading: "",
  introText: "",
  supportText: "",
  showHomeLink: true,
  showGiftVouchers: true,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function str(v: unknown, fallback: string, max: number): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
}
function hex(v: unknown, fallback: string): string {
  return typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback;
}
function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

// A stored early-day rule, or null if it isn't usable. Anything malformed falls
// back to null rather than a half-rule: the venue then simply runs one window
// all day, which is the behaviour it had before this setting existed.
function earlyWindow(value: unknown): SiteSettings["earlyRequestWindow"] {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const minutes = Math.round(Number(o.minutes));
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return null;
  const untilTime = typeof o.untilTime === "string" ? o.untilTime : "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(untilTime)) return null;
  const days = Array.isArray(o.days)
    ? [...new Set(o.days.map((d) => Math.round(Number(d))).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
    : [];
  if (days.length === 0) return null;
  return { minutes, untilTime, days: days.sort((a, b) => a - b) };
}

export function normalizeSiteSettings(input: unknown): SiteSettings {
  const o = (input ?? {}) as Record<string, unknown>;
  const d = DEFAULT_SITE_SETTINGS;
  return {
    windowDays: int(o.windowDays, d.windowDays, 1, 365),
    // Up to a day: beyond that every session on the site would be request-only.
    requestWindowMinutes: int(o.requestWindowMinutes, d.requestWindowMinutes, 0, 1440),
    earlyRequestWindow: earlyWindow(o.earlyRequestWindow),
    availableLabel: str(o.availableLabel, d.availableLabel, 30),
    soldOutLabel: str(o.soldOutLabel, d.soldOutLabel, 30),
    brandColor: hex(o.brandColor, d.brandColor),
    buttonBg: hex(o.buttonBg, d.buttonBg),
    buttonText: hex(o.buttonText, d.buttonText),
    // Basic shape check only (this module stays database-free and client-safe);
    // the save API also rejects any URL our own upload endpoint didn't produce.
    logoUrl:
      typeof o.logoUrl === "string" && o.logoUrl.trim() && o.logoUrl.length <= 8_000_000 ? o.logoUrl.trim() : null,
    appIconUrl:
      typeof o.appIconUrl === "string" && o.appIconUrl.trim() && o.appIconUrl.length <= 8_000_000
        ? o.appIconUrl.trim()
        : null,
    holdMinutes: int(o.holdMinutes, d.holdMinutes, 1, 120),
    basketExpiredText: str(o.basketExpiredText, d.basketExpiredText, 300),
    // these three are optional copy — empty means "don't show"
    introHeading: typeof o.introHeading === "string" ? o.introHeading.trim().slice(0, 120) : d.introHeading,
    introText: typeof o.introText === "string" ? o.introText.trim().slice(0, 600) : d.introText,
    supportText: typeof o.supportText === "string" ? o.supportText.trim().slice(0, 300) : d.supportText,
    // Shown unless explicitly switched off, so a venue that has never saved
    // these keeps both links.
    showHomeLink: o.showHomeLink !== false,
    showGiftVouchers: o.showGiftVouchers !== false,
  };
}
