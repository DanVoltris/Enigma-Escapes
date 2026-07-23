// Customer booking-site settings: appearance, availability window, basket hold
// and on-site copy. Every field here is wired to real behaviour on the site —
// nothing is decorative. Stored in the `settings` table under "booking_site".
import { getSetting } from "./settings";
import { BOOKING_WINDOW_DAYS, HOLD_MINUTES } from "./pricing";

export type SiteSettings = {
  // availability
  windowDays: number; // how far ahead customers can book
  availableLabel: string; // CTA on a bookable slot
  soldOutLabel: string; // label on a full slot
  // colours (customer site only)
  brandColor: string; // accent used for highlights
  buttonBg: string;
  buttonText: string;
  // shopping basket
  holdMinutes: number; // how long a cart holds its slots
  basketExpiredText: string;
  // content
  introHeading: string;
  introText: string;
  supportText: string;
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  windowDays: BOOKING_WINDOW_DAYS,
  availableLabel: "Book now",
  soldOutLabel: "Sold out",
  brandColor: "#87cefa",
  buttonBg: "#87cefa",
  buttonText: "#0b2540",
  holdMinutes: HOLD_MINUTES,
  basketExpiredText:
    "You are out of time. Your held slots have been released — please pick your times again to continue.",
  introHeading: "",
  introText: "",
  supportText: "",
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

export function normalizeSiteSettings(input: unknown): SiteSettings {
  const o = (input ?? {}) as Record<string, unknown>;
  const d = DEFAULT_SITE_SETTINGS;
  return {
    windowDays: int(o.windowDays, d.windowDays, 1, 365),
    availableLabel: str(o.availableLabel, d.availableLabel, 30),
    soldOutLabel: str(o.soldOutLabel, d.soldOutLabel, 30),
    brandColor: hex(o.brandColor, d.brandColor),
    buttonBg: hex(o.buttonBg, d.buttonBg),
    buttonText: hex(o.buttonText, d.buttonText),
    holdMinutes: int(o.holdMinutes, d.holdMinutes, 1, 120),
    basketExpiredText: str(o.basketExpiredText, d.basketExpiredText, 300),
    // these three are optional copy — empty means "don't show"
    introHeading: typeof o.introHeading === "string" ? o.introHeading.trim().slice(0, 120) : d.introHeading,
    introText: typeof o.introText === "string" ? o.introText.trim().slice(0, 600) : d.introText,
    supportText: typeof o.supportText === "string" ? o.supportText.trim().slice(0, 300) : d.supportText,
  };
}

// Never throws — the customer site must render even if settings are unreachable.
export async function getSiteSettings(): Promise<SiteSettings> {
  try {
    const { value } = await getSetting<Partial<SiteSettings>>("booking_site");
    return normalizeSiteSettings(value);
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}
