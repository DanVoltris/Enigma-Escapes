import { NextResponse } from "next/server";
import { taxSummary } from "@/lib/taxes";
import { DEFAULT_PRICING_MODE, DEFAULT_TAX_PERCENT } from "@/lib/pricing";
import { getPricingMode } from "@/lib/pricing-settings";

export const dynamic = "force-dynamic";

// Public: the combined active tax rate + label, so the customer flow can show
// and total the same tax the server will charge.
export async function GET() {
  try {
    const [{ percent, label }, mode] = await Promise.all([taxSummary(), getPricingMode()]);
    return NextResponse.json({ percent, label, mode });
  } catch (err) {
    console.error("tax summary failed:", err);
    return NextResponse.json({ percent: DEFAULT_TAX_PERCENT, label: "Tax", mode: DEFAULT_PRICING_MODE });
  }
}
