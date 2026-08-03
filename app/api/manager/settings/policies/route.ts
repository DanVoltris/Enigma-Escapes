import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { normalizePolicies, saveSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const guard = await apiGuard("settings");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const policies = normalizePolicies(body); // clamps values; drops anything invalid

  try {
    await saveSetting("booking_policies", policies);
    await logActivity(
      "Updated booking policies",
      `reschedule ${policies.reschedule.show ? "shown" : "hidden"}, cancellation ${
        policies.cancellation.show ? "shown" : "hidden"
      }`
    );
    return NextResponse.json({ ok: true, policies });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save right now. Please try again.";
    console.error("saving booking policies failed:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
