// How prices relate to tax, and what a deposit costs. Owner-configurable in
// Settings → Taxes & fees, stored in the settings table under "pricing_mode".
import { CORPORATE_FEE_CENTS, DEFAULT_PRICING_MODE, type PricingMode } from "./pricing";
import { getSetting, saveSetting } from "./settings";

const KEY = "pricing_mode";

export function normalizePricingMode(input: unknown): PricingMode {
  const o = (input ?? {}) as Record<string, unknown>;
  const flat = o.depositFlatCents;
  const fee = o.corporateFeeCents;
  return {
    taxInclusive: o.taxInclusive === true,
    depositFlatCents:
      typeof flat === "number" && Number.isInteger(flat) && flat > 0 && flat <= 1_000_00 ? flat : null,
    // Zero is allowed (a venue that doesn't charge one); anything unreadable
    // keeps the default rather than silently making events free.
    corporateFeeCents:
      typeof fee === "number" && Number.isInteger(fee) && fee >= 0 && fee <= 10_000_00 ? fee : CORPORATE_FEE_CENTS,
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
