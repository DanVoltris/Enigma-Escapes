import type { LocaleConfig } from "./format";
import { normalizeLocale } from "./locale-options";
import { getSetting } from "./settings";

// Server-only: read the business's locale config from the settings table,
// normalised against the allowed options. Falls back to defaults when the
// table or row doesn't exist yet (so the app works before anything is saved).
export async function getLocale(): Promise<LocaleConfig> {
  try {
    const { value } = await getSetting<unknown>("locale");
    return normalizeLocale(value);
  } catch {
    return normalizeLocale(null);
  }
}
