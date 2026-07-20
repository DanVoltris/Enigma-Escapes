import { NextResponse } from "next/server";
import { taxSummary } from "@/lib/taxes";
import { DEFAULT_TAX_PERCENT } from "@/lib/pricing";

export const dynamic = "force-dynamic";

// Public: the combined active tax rate + label, so the customer flow can show
// and total the same tax the server will charge.
export async function GET() {
  try {
    const { percent, label } = await taxSummary();
    return NextResponse.json({ percent, label });
  } catch (err) {
    console.error("tax summary failed:", err);
    return NextResponse.json({ percent: DEFAULT_TAX_PERCENT, label: "Tax" });
  }
}
