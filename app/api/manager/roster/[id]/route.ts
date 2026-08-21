import { apiGuard } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { deleteStaffMember, updateStaffMember } from "@/lib/staff-members";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("roster");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const patch: Parameters<typeof updateStaffMember>[1] = {};
  if (typeof o.name === "string") patch.name = o.name;
  if (o.homeLocation === null || typeof o.homeLocation === "string") {
    patch.homeLocation = (o.homeLocation as string | null) || null;
  }
  if (typeof o.active === "boolean") patch.active = o.active;
  if (Array.isArray(o.trainedRooms)) {
    patch.trainedRooms = (o.trainedRooms as unknown[]).filter((r): r is string => typeof r === "string").slice(0, 50);
  }

  try {
    const ok = await updateStaffMember(id, patch);
    if (!ok) return NextResponse.json({ error: "That person no longer exists." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updating staff member failed:", err);
    return NextResponse.json({ error: "Could not save that change right now." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("roster");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;
  try {
    const ok = await deleteStaffMember(id);
    if (!ok) return NextResponse.json({ error: "That person no longer exists." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("removing staff member failed:", err);
    return NextResponse.json({ error: "Could not remove that person right now." }, { status: 500 });
  }
}
