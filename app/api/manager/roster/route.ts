import { apiGuard } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/db";
import { createStaffMember } from "@/lib/staff-members";

export const dynamic = "force-dynamic";

// Add someone to the roster. Managing the roster is staff administration;
// checking in and out is not, and lives on its own route.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("roster");
  if (guard.response) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  if (name.length > 80) return NextResponse.json({ error: "That name is too long." }, { status: 400 });
  const homeLocation = typeof o.homeLocation === "string" && o.homeLocation ? o.homeLocation : null;

  try {
    const member = await createStaffMember(name, homeLocation);
    await logActivity("Staff member added", name);
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    console.error("adding staff member failed:", err);
    return NextResponse.json({ error: "Could not add that person right now." }, { status: 500 });
  }
}
