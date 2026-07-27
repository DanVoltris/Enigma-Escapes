// Customer booking-site settings: appearance, availability window, basket hold
// and on-site copy. Every field here is wired to real behaviour on the site —
// nothing is decorative. Stored in the `settings` table under "booking_site".
//
// The shape, defaults and validation live in the DB-free ./site-settings-defaults
// module so client components can use them; this file adds the database read.
// Re-exported here so existing importers of "@/lib/site-settings" keep working.
import { getSetting } from "./settings";
import { DEFAULT_SITE_SETTINGS, normalizeSiteSettings, type SiteSettings } from "./site-settings-defaults";

export { DEFAULT_SITE_SETTINGS, normalizeSiteSettings, type SiteSettings };

// Never throws — the customer site must render even if settings are unreachable.
export async function getSiteSettings(): Promise<SiteSettings> {
  try {
    const { value } = await getSetting<Partial<SiteSettings>>("booking_site");
    return normalizeSiteSettings(value);
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}
