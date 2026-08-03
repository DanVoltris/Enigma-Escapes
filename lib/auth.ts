// Auth guards for the staff portal. Pages use requireStaff/requirePermission
// (they redirect); API routes use apiGuard (it returns a 401/403 Response).
// Every restricted surface re-checks here — hiding a nav link is not security.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, staffForToken, type Permission, type StaffAccount } from "./staff";

export async function currentStaff(): Promise<StaffAccount | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  try {
    return await staffForToken(token);
  } catch {
    return null; // a lookup failure must read as "not signed in", never as "allowed"
  }
}

export function hasPermission(staff: StaffAccount, permission: Permission): boolean {
  return staff.permissions.includes(permission);
}

// Page guard: bounces to the login screen, remembering where they were headed.
export async function requireStaff(returnTo?: string): Promise<StaffAccount> {
  const staff = await currentStaff();
  if (!staff) redirect(`/login${returnTo ? `?next=${encodeURIComponent(returnTo)}` : ""}`);
  return staff;
}

// Page guard for a specific capability. Sends the signed-in-but-unauthorised
// to the portal home rather than the login screen (they ARE logged in).
export async function requirePermission(permission: Permission, returnTo?: string): Promise<StaffAccount> {
  const staff = await requireStaff(returnTo);
  if (!hasPermission(staff, permission)) redirect("/manager?denied=1");
  return staff;
}

// API guard. Returns { staff } on success, or { response } to return as-is.
export async function apiGuard(
  permission?: Permission
): Promise<{ staff: StaffAccount; response?: never } | { staff?: never; response: NextResponse }> {
  const staff = await currentStaff();
  if (!staff) {
    return { response: NextResponse.json({ error: "Please sign in again." }, { status: 401 }) };
  }
  if (permission && !hasPermission(staff, permission)) {
    return {
      response: NextResponse.json({ error: "Your account doesn't have access to that." }, { status: 403 }),
    };
  }
  return { staff };
}

// Which locations this account may see — null means "all of them".
export function allowedLocations(staff: StaffAccount): string[] | null {
  if (staff.role === "admin" || staff.locations.length === 0) return null;
  return staff.locations;
}

export function canSeeLocation(staff: StaffAccount, location: string): boolean {
  const allowed = allowedLocations(staff);
  return allowed === null || allowed.includes(location);
}
