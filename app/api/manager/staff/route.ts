import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import {
  createStaff,
  defaultPermissionsFor,
  loginProblem,
  passwordProblem,
  PERMISSIONS,
  type Permission,
  type StaffRole,
} from "@/lib/staff";

export const dynamic = "force-dynamic";

function cleanRole(v: unknown): StaffRole {
  return v === "admin" || v === "manager" ? v : "clerk";
}

function cleanPermissions(v: unknown, role: StaffRole): Permission[] {
  if (!Array.isArray(v)) return defaultPermissionsFor(role);
  return (v as string[]).filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard("staff");
  if (guard.response) return guard.response;

  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 80) : "";
  const email = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
  const password = typeof o.password === "string" ? o.password : "";
  if (!name) return NextResponse.json({ error: "Enter the person's name." }, { status: 400 });
  const loginIssue = loginProblem(email);
  if (loginIssue) return NextResponse.json({ error: loginIssue }, { status: 400 });
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const role = cleanRole(o.role);
  const locations = Array.isArray(o.locations) ? (o.locations as unknown[]).filter((l): l is string => typeof l === "string") : [];

  try {
    const account = await createStaff({
      email,
      name,
      password,
      role,
      locations,
      permissions: cleanPermissions(o.permissions, role),
    });
    await logActivity("Staff account created", `${name} (${role})`);
    return NextResponse.json({ ok: true, id: account.id }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not create the account.";
    console.error("creating staff failed:", err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
