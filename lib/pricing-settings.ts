// How prices relate to tax, and what a deposit costs. Owner-configurable in
// Settings → Taxes & fees, stored in the settings table under "pricing_mode".
import { DEFAULT_PRICING_MODE, type PricingMode } from "./pricing";
import { getSetting, saveSetting } from "./settings";

const KEY = "pricing_mode";

export function normalizePricingMode(input: unknown): PricingMode {
  const o = (input ?? {}) as Record<string, unknown>;
  const flat = o.depositFlatCents;
  return {
    taxInclusive: o.taxInclusive === true,
    depositFlatCents:
      typeof flat === "number" && Number.isInteger(flat) && flat > 0 && flat <= 1_000_00 ? flat : null,
  };
}

// Never throws — the booking flow must price correctly even if settings are
// unreachable, falling back to the historical tax-on-top behaviour.
export async function getPricingMode(): Promise<PricingMode> {
  try {
    const { value } = await getSetting<Partial<PricingMode>>(KEY);
    return value ? normalizePricingMode(value) : DEFAULT_PRICING_MODE;
  } catch {
    return DEFAULT_PRICING_MODE;
  }
}

export async function savePricingMode(mode: PricingMode): Promise<void> {
  await saveSetting(KEY, mode);
}
