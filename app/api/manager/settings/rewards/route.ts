import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { normalizeRewardSettings, saveRewardSettings } from "@/lib/reward-settings";

export const dynamic = "force-dynamic";

// Whether every booking earns the standard next-visit code, or only the ones
// booked with a promo code that grants one.
export async function PUT(req: NextRequest) {
  const guard = await apiGuard("settings");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const rewards = normalizeRewardSettings(body);
  try {
    await saveRewardSettings(rewards);
    await logActivity(
      "Updated next-visit codes",
      rewards.everyBooking ? "every booking earns one" : "only promo codes that grant one"
    );
    return NextResponse.json({ ok: true, rewards });
  } catch (err) {
    console.error("saving reward settings failed:", err);
    return NextResponse.json({ error: "Could not save that right now. Please try again." }, { status: 500 });
  }
}
