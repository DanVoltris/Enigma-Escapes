// Staff accounts, passwords and sessions for the manager/staff portal.
// Server-only. Passwords are hashed with scrypt (Node built-in, memory-hard);
// session cookies carry a random token whose SHA-256 is what's stored, so a
// database leak can't be replayed as a login. Sessions live in a table rather
// than a signed cookie so access can be revoked instantly (deactivate = out).
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { rest, restError } from "./supabase";

export {
  PERMISSIONS,
  PERMISSION_LABELS,
  defaultPermissionsFor,
  type Permission,
  type StaffRole,
  type StaffAccount,
} from "./permissions";
import { PERMISSIONS, type Permission, type StaffAccount, type StaffRole } from "./permissions";

type Row = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  locations: unknown;
  permissions: unknown;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
};

function toAccount(r: Row): StaffAccount {
  const role: StaffRole = r.role === "admin" || r.role === "manager" ? r.role : "clerk";
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role,
    locations: Array.isArray(r.locations) ? (r.locations as string[]) : [],
    permissions: Array.isArray(r.permissions)
      ? (r.permissions as string[]).filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p))
      : [],
    active: r.active !== false,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  };
}

// ---------- passwords ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Deliberately permissive on composition, strict on length — length is what
// actually matters, and staff will pick worse passwords if we nag them.
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "That password is too long.";
  return null;
}

// ---------- accounts ----------

export async function listStaff(): Promise<StaffAccount[]> {
  const res = await rest("staff_accounts?select=*&order=created_at.asc");
  if (res.status === 404) return []; // table not created yet
  if (!res.ok) throw await restError(res, "Loading staff accounts");
  return ((await res.json()) as Row[]).map(toAccount);
}

export async function staffCount(): Promise<number> {
  return (await listStaff()).length;
}

export async function getStaffById(id: string): Promise<StaffAccount | undefined> {
  const res = await rest(`staff_accounts?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  if (!res.ok) return undefined;
  const rows = (await res.json()) as Row[];
  return rows[0] ? toAccount(rows[0]) : undefined;
}

export async function createStaff(input: {
  email: string;
  name: string;
  password: string;
  role: StaffRole;
  locations: string[];
  permissions: Permission[];
}): Promise<StaffAccount> {
  const email = input.email.trim().toLowerCase();
  const existing = (await listStaff()).find((s) => s.email === email);
  if (existing) throw new Error("An account with that email already exists.");
  const row = {
    id: randomUUID(),
    email,
    name: input.name.trim(),
    password_hash: hashPassword(input.password),
    role: input.role,
    locations: input.locations,
    permissions: input.permissions,
    active: true,
    created_at: new Date().toISOString(),
    last_login_at: null,
  };
  const res = await rest("staff_accounts", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw await restError(res, "Creating the account");
  return toAccount(row as unknown as Row);
}

export async function updateStaff(
  id: string,
  patch: Partial<{ name: string; role: StaffRole; locations: string[]; permissions: Permission[]; active: boolean }>
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.locations !== undefined) row.locations = patch.locations;
  if (patch.permissions !== undefined) row.permissions = patch.permissions;
  if (patch.active !== undefined) row.active = patch.active;
  const res = await rest(`staff_accounts?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw await restError(res, "Updating the account");
  // Losing access takes effect immediately, not at the next login.
  if (patch.active === false) await revokeAllSessions(id);
}

export async function setPassword(id: string, password: string): Promise<void> {
  const res = await rest(`staff_accounts?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ password_hash: hashPassword(password) }),
  });
  if (!res.ok) throw await restError(res, "Setting the password");
  await revokeAllSessions(id); // a password change signs other devices out
}

export async function deleteStaff(id: string): Promise<void> {
  await revokeAllSessions(id);
  const res = await rest(`staff_accounts?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok) throw await restError(res, "Deleting the account");
}

// ---------- sessions ----------

const SESSION_DAYS = 7;
export const SESSION_COOKIE = "vb_staff";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Returns the raw token for the cookie; only its hash is stored.
export async function signIn(email: string, password: string): Promise<{ token: string; staff: StaffAccount } | null> {
  const res = await rest(`staff_accounts?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=*&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as Row[];
  const row = rows[0];
  // Hash even when the account is missing so timing doesn't reveal who exists.
  const stored = row?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`;
  const ok = verifyPassword(password, stored);
  if (!row || !ok || row.active === false) return null;

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  const created = await rest("staff_sessions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      token_hash: hashToken(token),
      staff_id: row.id,
      expires_at: expires,
      created_at: new Date().toISOString(),
    }),
  });
  if (!created.ok) throw await restError(created, "Starting the session");
  await rest(`staff_accounts?id=eq.${row.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ last_login_at: new Date().toISOString() }),
  });
  return { token, staff: toAccount(row) };
}

export async function staffForToken(token: string): Promise<StaffAccount | null> {
  if (!token) return null;
  const res = await rest(`staff_sessions?token_hash=eq.${hashToken(token)}&select=*&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as { staff_id: string; expires_at: string }[];
  const session = rows[0];
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await revokeSession(token);
    return null;
  }
  const staff = await getStaffById(session.staff_id);
  return staff && staff.active ? staff : null;
}

export async function revokeSession(token: string): Promise<void> {
  await rest(`staff_sessions?token_hash=eq.${hashToken(token)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function revokeAllSessions(staffId: string): Promise<void> {
  await rest(`staff_sessions?staff_id=eq.${encodeURIComponent(staffId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}
