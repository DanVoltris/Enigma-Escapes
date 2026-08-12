import { apiGuard } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { checkIn, checkOut, listStaffMembers } from "@/lib/staff-members";

export const dynamic = "force-dynamic";

// Checking in and out. Open to any signed-in staff, not just managers —
// everyone shares a few logins, so gating this behind staff administration
// would stop the very people it exists for from using it.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("bookings.view");
  if (guard.response) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const memberId = typeof o.memberId === "string" ? o.memberId : "";
  const action = o.action === "out" ? "out" : "in";
  const location = typeof o.location === "string" && o.location ? o.location : null;
  if (!memberId) return NextResponse.json({ error: "Choose who is checking in." }, { status: 400 });

  try {
    if (action === "out") {
      const ok = await checkOut(memberId);
      if (!ok) return NextResponse.json({ error: "They weren't checked in." }, { status: 409 });
      return NextResponse.json({ ok: true });
    }
    const member = (await listStaffMembers()).find((m) => m.id === memberId);
    if (!member) return NextResponse.json({ error: "That person isn't on the staff list." }, { status: 404 });
    if (!member.active) return NextResponse.json({ error: `${member.name} is marked inactive.` }, { status: 409 });
    const result = await checkIn(member, location);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, shift: result.shift }, { status: 201 });
  } catch (err) {
    console.error("staff clock action failed:", err);
    return NextResponse.json({ error: "Could not record that right now. Please try again." }, { status: 500 });
  }
}
