import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { normalizePricingMode, savePricingMode } from "@/lib/pricing-settings";

export const dynamic = "force-dynamic";

// How listed prices relate to tax, and the deposit rule.
export async function PUT(req: NextRequest) {
  const guard = await apiGuard("settings");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  // A deposit of "0" means none — say so rather than silently ignoring it.
  if (o.depositFlatCents != null && o.depositFlatCents !== "" && !Number.isInteger(o.depositFlatCents)) {
    return NextResponse.json({ error: "Enter the deposit as a whole dollar amount." }, { status: 400 });
  }
  const mode = normalizePricingMode(o);
  try {
    await savePricingMode(mode);
    await logActivity(
      "Pricing rules updated",
      `${mode.taxInclusive ? "Prices include tax" : "Tax added at checkout"}; deposit ${
        mode.depositFlatCents != null ? `$${(mode.depositFlatCents / 100).toFixed(2)} flat` : "by percentage"
      }`
    );
    return NextResponse.json({ ok: true, mode });
  } catch (err) {
    console.error("saving pricing mode failed:", err);
    return NextResponse.json({ error: "Could not save that right now. Please try again." }, { status: 500 });
  }
}
