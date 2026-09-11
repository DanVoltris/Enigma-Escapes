import { deploymentTimezone, type LocaleConfig } from "./format";
import { normalizeLocale } from "./locale-options";
import { getSetting } from "./settings";

// Server-only: read the business's locale config from the settings table,
// normalised against the allowed options. Falls back to defaults when the
// table or row doesn't exist yet (so the app works before anything is saved).
// A deployment's VENUE_TIMEZONE wins over the stored timezone, so the pages
// agree with the API routes, which only ever see that variable.
export async function getLocale(): Promise<LocaleConfig> {
  let locale: LocaleConfig;
  try {
    const { value } = await getSetting<unknown>("locale");
    locale = normalizeLocale(value);
  } catch {
    locale = normalizeLocale(null);
  }
  const fixed = deploymentTimezone();
  return fixed ? { ...locale, timezone: fixed } : locale;
}
