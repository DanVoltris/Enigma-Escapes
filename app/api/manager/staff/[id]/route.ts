import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import {
  deleteStaff,
  getStaffById,
  listStaff,
  passwordProblem,
  PERMISSIONS,
  setPassword,
  updateStaff,
  type Permission,
  type StaffRole,
} from "@/lib/staff";

export const dynamic = "force-dynamic";

// Guards against locking everyone out: the last active admin can't be
// demoted, deactivated or deleted, and nobody can disable their own account.
async function lastAdminProblem(targetId: string, becomingInactiveOrDemoted: boolean): Promise<string | null> {
  if (!becomingInactiveOrDemoted) return null;
  const all = await listStaff();
  const activeAdmins = all.filter((s) => s.role === "admin" && s.active);
  if (activeAdmins.length <= 1 && activeAdmins[0]?.id === targetId) {
    return "This is the only active admin — promote someone else first.";
  }
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("staff");
  if (guard.response) return guard.response;
  const { id } = await params;
  const target = await getStaffById(id);
  if (!target) return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });

  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Parameters<typeof updateStaff>[1] = {};
  if (typeof o.name === "string") patch.name = o.name.trim().slice(0, 80);
  if (o.role === "admin" || o.role === "manager" || o.role === "clerk") patch.role = o.role as StaffRole;
  if (Array.isArray(o.locations)) {
    patch.locations = (o.locations as unknown[]).filter((l): l is string => typeof l === "string");
  }
  if (Array.isArray(o.permissions)) {
    patch.permissions = (o.permissions as string[]).filter((p): p is Permission =>
      (PERMISSIONS as readonly string[]).includes(p)
    );
  }
  if (typeof o.active === "boolean") patch.active = o.active;

  if (patch.active === false && guard.staff.id === id) {
    return NextResponse.json({ error: "You can't deactivate your own account." }, { status: 400 });
  }
  const problem = await lastAdminProblem(
    id,
    patch.active === false || (patch.role !== undefined && patch.role !== "admin" && target.role === "admin")
  );
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    await updateStaff(id, patch);
    await logActivity("Staff account updated", `${target.name}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updating staff failed:", err);
    return NextResponse.json({ error: "Could not update the account. Please try again." }, { status: 500 });
  }
}

// Reset someone's password (admin sets a temporary one and tells them).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("staff");
  if (guard.response) return guard.response;
  const { id } = await params;
  const target = await getStaffById(id);
  if (!target) return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });

  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const password = typeof o.password === "string" ? o.password : "";
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    await setPassword(id, password);
    await logActivity("Staff password reset", target.name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("resetting password failed:", err);
    return NextResponse.json({ error: "Could not reset the password. Please try again." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("staff");
  if (guard.response) return guard.response;
  const { id } = await params;
  const target = await getStaffById(id);
  if (!target) return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });
  if (guard.staff.id === id) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  }
  const problem = await lastAdminProblem(id, true);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    await deleteStaff(id);
    await logActivity("Staff account deleted", target.name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleting staff failed:", err);
    return NextResponse.json({ error: "Could not delete the account. Please try again." }, { status: 500 });
  }
}
