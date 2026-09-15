import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { markSeen, nudgeIfDue, pushConfigured, pushLater } from "@/lib/push";

export const dynamic = "force-dynamic";

// The portal was opened on a phone that has notifications on. Keeps its "last
// opened" current and tells the page whether the phone is still receiving, so
// a phone whose notifications stopped can be reconnected on the spot.
export async function POST(req: NextRequest) {
  const guard = await apiGuard();
  if (guard.response) return guard.response;
  if (!pushConfigured()) return NextResponse.json({ status: "off" });
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof o.endpoint !== "string" || o.endpoint.length > 1000) {
    return NextResponse.json({ error: "Missing the phone's notification address." }, { status: 400 });
  }
  try {
    const seen = await markSeen(o.endpoint, guard.staff.id);
    // Staff opening the portal is the traffic the daily reminder rides on.
    pushLater(() => nudgeIfDue(req.nextUrl.origin));
    return NextResponse.json(seen);
  } catch (err) {
    console.error("recording notification device visit failed:", err);
    return NextResponse.json({ status: "error" });
  }
}
