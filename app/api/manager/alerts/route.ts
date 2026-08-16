import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { phoneProblem } from "@/lib/request-alerts";
import { getStaffMember, updateStaffMember } from "@/lib/staff-members";
import { updateStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

// One row of the booking-request alert list. Roster people carry a switch;
// managers and admins carry only a number, because theirs is always on.
export async function PATCH(req: NextRequest) {
  const guard = await apiGuard("alerts");
  if (guard.response) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const source = raw.source === "account" ? "account" : raw.source === "roster" ? "roster" : "";
  if (!id || !source) return NextResponse.json({ error: "Which person is being changed?" }, { status: 400 });

  const patch: { phone?: string | null; requestAlerts?: boolean } = {};
  if (raw.phone !== undefined) {
    const phone = typeof raw.phone === "string" ? raw.phone.trim() : "";
    const problem = phoneProblem(phone);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    patch.phone = phone || null;
  }
  if (raw.requestAlerts !== undefined) {
    if (source === "account") {
      // Not a mistake worth accommodating: managers and admins are always on.
      return NextResponse.json(
        { error: "Managers and admins always get these texts. Clear their number to stop them." },
        { status: 400 }
      );
    }
    patch.requestAlerts = raw.requestAlerts === true;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  try {
    if (source === "account") {
      await updateStaff(id, { phone: patch.phone ?? null });
    } else {
      const found = await updateStaffMember(id, patch);
      if (!found) return NextResponse.json({ error: "That person is no longer on the list." }, { status: 404 });
    }
    if (patch.requestAlerts !== undefined) {
      // Named. "someone on the staff list" was useless the first time anyone
      // asked why a particular person was still getting texts.
      const who = source === "roster" ? (await getStaffMember(id).catch(() => undefined))?.name : null;
      await logActivity(
        "Booking request alerts changed",
        `${guard.staff.name} turned request texts ${patch.requestAlerts ? "on" : "off"} for ${who ?? "a staff member"}`
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updating the request alert list failed:", err);
    return NextResponse.json({ error: "Could not save that. Try again shortly." }, { status: 500 });
  }
}
