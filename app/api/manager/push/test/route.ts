import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { pushConfigured, pushTest } from "@/lib/push";

export const dynamic = "force-dynamic";

// "Send a test": one notification to every phone the signed-in person has on.
export async function POST(req: NextRequest) {
  const guard = await apiGuard();
  if (guard.response) return guard.response;
  if (!pushConfigured()) {
    return NextResponse.json({ error: "Phone notifications aren't set up for this venue yet." }, { status: 503 });
  }
  try {
    return NextResponse.json(await pushTest(guard.staff.id, req.nextUrl.origin));
  } catch (err) {
    console.error("test notification failed:", err);
    return NextResponse.json({ error: "Could not send the test. Please try again." }, { status: 500 });
  }
}
