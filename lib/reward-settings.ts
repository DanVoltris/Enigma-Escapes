// Who earns a next-visit code, and on what terms.
//
// The house rule — every booking earns 20% off, spendable only before the
// session that earned it starts — is now a switch, because a venue can instead
// hand the code out through a promo code (Settings → Promo codes: "earns a
// follow-up code"). Time Zone does that for its hotel guests: book with the
// hotel's code, get 20% off for the week that follows. Its other customers
// don't get one, so the offer means something.
import { getSetting, saveSetting } from "./settings";

const KEY = "rewards";

export type RewardSettings = {
  // Every booking earns the standard code. True is the behaviour every venue
  // had before this setting existed, so leaving it alone changes nothing.
  everyBooking: boolean;
};

export const DEFAULT_REWARD_SETTINGS: RewardSettings = { everyBooking: true };

export function normalizeRewardSettings(input: unknown): RewardSettings {
  const o = (input ?? {}) as Record<string, unknown>;
  return { everyBooking: o.everyBooking !== false };
}

// Never throws: a booking must confirm even if settings are unreachable, and
// the fallback is the long-standing behaviour.
export async function getRewardSettings(): Promise<RewardSettings> {
  try {
    const { value } = await getSetting<Partial<RewardSettings>>(KEY);
    return value ? normalizeRewardSettings(value) : DEFAULT_REWARD_SETTINGS;
  } catch {
    return DEFAULT_REWARD_SETTINGS;
  }
}

export async function saveRewardSettings(next: RewardSettings): Promise<void> {
  await saveSetting(KEY, normalizeRewardSettings(next));
}
