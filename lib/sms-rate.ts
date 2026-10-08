// What a text segment costs this venue, and how fast they go out.
//
// Both were guesses baked into the page: 1.1 cents a segment and sixty texts a
// minute. The first Halloween campaign billed about 1.7 cents a segment and ran
// at eighty-three a minute, so the estimate read half the real bill. The rate
// is now the venue's to set — it is their Twilio account, their currency and
// their carrier fees — and the speed is what we have actually measured.
import { getSetting, saveSetting } from "./settings";

const KEY = "sms_rate";

// Twilio's list price for Canada plus the carrier fee that rides along with it,
// which is roughly what Enigma was charged. A venue elsewhere sets its own.
export const DEFAULT_RATE_CENTS = 1.7;

// Measured over 9,046 texts on a plain phone number, start to finish.
export const TEXTS_PER_MINUTE = 83;

export function normalizeRateCents(raw: unknown): number {
  const n = Number(raw);
  // A cent either side of nothing is a typo, and a dollar a text is a disaster.
  return Number.isFinite(n) && n > 0 && n <= 50 ? Math.round(n * 1000) / 1000 : DEFAULT_RATE_CENTS;
}

export async function getSmsRateCents(): Promise<number> {
  try {
    const { value } = await getSetting<{ centsPerSegment?: unknown }>(KEY);
    return value ? normalizeRateCents(value.centsPerSegment) : DEFAULT_RATE_CENTS;
  } catch {
    return DEFAULT_RATE_CENTS;
  }
}

export async function saveSmsRateCents(cents: number): Promise<void> {
  await saveSetting(KEY, { centsPerSegment: normalizeRateCents(cents) });
}
