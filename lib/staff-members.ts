// The people who actually run the games, and when they're on shift.
//
// Deliberately separate from staff_accounts (lib/staff.ts). Those are logins,
// and a handful of them are shared by everyone — so the account signed in says
// nothing about who is standing at the desk. A shift is claimed by a person
// picking their own name, which is the only thing that makes the hours mean
// anything on a shared login.
import { randomUUID } from "crypto";
import { rest, restError } from "./supabase";
import type { Shift, StaffMember } from "./staff-types";

export type { Shift, StaffMember } from "./staff-types";
export { formatDuration, shiftMinutes } from "./staff-types";

type MemberRow = {
  id: string;
  name: string;
  home_location: string | null;
  trained_rooms: string[] | null;
  active: boolean;
  phone: string | null;
  request_alerts: boolean | null;
};

type ShiftRow = {
  id: string;
  member_id: string;
  member_name: string;
  location: string | null;
  started_at: string;
  ended_at: string | null;
};

const toMember = (r: MemberRow): StaffMember => ({
  id: r.id,
  name: r.name,
  homeLocation: r.home_location,
  trainedRooms: r.trained_rooms ?? [],
  active: r.active,
  phone: r.phone ?? null,
  requestAlerts: r.request_alerts === true,
});

const toShift = (r: ShiftRow): Shift => ({
  id: r.id,
  memberId: r.member_id,
  memberName: r.member_name,
  location: r.location,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});

export async function listStaffMembers(): Promise<StaffMember[]> {
  const res = await rest("staff_members?select=*&order=name.asc");
  if (!res.ok) throw await restError(res, "Loading the staff list");
  return ((await res.json()) as MemberRow[]).map(toMember);
}

export async function createStaffMember(name: string, homeLocation: string | null): Promise<StaffMember | undefined> {
  const row = {
    id: randomUUID(),
    name: name.trim().slice(0, 80),
    home_location: homeLocation,
    trained_rooms: [],
    active: true,
    created_at: new Date().toISOString(),
  };
  const res = await rest("staff_members", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw await restError(res, "Adding that person");
  const rows = (await res.json()) as MemberRow[];
  return rows[0] ? toMember(rows[0]) : undefined;
}

export async function updateStaffMember(
  id: string,
  patch: {
    name?: string;
    homeLocation?: string | null;
    trainedRooms?: string[];
    active?: boolean;
    phone?: string | null;
    requestAlerts?: boolean;
  }
): Promise<boolean> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name.trim().slice(0, 80);
  if (patch.homeLocation !== undefined) body.home_location = patch.homeLocation;
  if (patch.trainedRooms !== undefined) body.trained_rooms = patch.trainedRooms;
  if (patch.active !== undefined) body.active = patch.active;
  if (patch.phone !== undefined) body.phone = patch.phone;
  if (patch.requestAlerts !== undefined) body.request_alerts = patch.requestAlerts;
  if (Object.keys(body).length === 0) return true;

  const res = await rest(`staff_members?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await restError(res, "Updating that person");
  return ((await res.json()) as MemberRow[]).length > 0;
}

export async function deleteStaffMember(id: string): Promise<boolean> {
  const res = await rest(`staff_members?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  if (!res.ok) throw await restError(res, "Removing that person");
  return ((await res.json()) as MemberRow[]).length > 0;
}

// Everyone currently on shift, anywhere.
export async function openShifts(): Promise<Shift[]> {
  const res = await rest("staff_shifts?select=*&ended_at=is.null&order=started_at.asc");
  if (!res.ok) throw await restError(res, "Loading who is on shift");
  return ((await res.json()) as ShiftRow[]).map(toShift);
}

// Recent shifts, newest first — the raw material for the hours list. Filtered
// by date in JS rather than SQL because the volume is tiny (a couple of dozen
// people) and it keeps the query working against the local mock store.
export async function recentShifts(limit = 500): Promise<Shift[]> {
  const res = await rest(`staff_shifts?select=*&order=started_at.desc&limit=${limit}`);
  if (!res.ok) throw await restError(res, "Loading shifts");
  return ((await res.json()) as ShiftRow[]).map(toShift);
}

export type CheckInResult = { ok: true; shift: Shift } | { ok: false; error: string };

// Starts a shift. The unique index on member_id-while-open is what actually
// prevents a double check-in — two taps on a slow connection race here.
export async function checkIn(member: StaffMember, location: string | null): Promise<CheckInResult> {
  const already = await openShifts();
  if (already.some((s) => s.memberId === member.id)) {
    return { ok: false, error: `${member.name} is already checked in.` };
  }
  const row = {
    id: randomUUID(),
    member_id: member.id,
    member_name: member.name,
    location,
    started_at: new Date().toISOString(),
    ended_at: null,
  };
  const res = await rest("staff_shifts", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (res.status === 409) return { ok: false, error: `${member.name} is already checked in.` };
  if (!res.ok) throw await restError(res, "Checking in");
  const rows = (await res.json()) as ShiftRow[];
  return rows[0]
    ? { ok: true, shift: toShift(rows[0]) }
    : { ok: false, error: "Could not check in — please try again." };
}

// Ends the open shift. Conditional on it still being open so two taps can't
// stamp two different finish times.
export async function checkOut(memberId: string): Promise<boolean> {
  const res = await rest(
    `staff_shifts?member_id=eq.${encodeURIComponent(memberId)}&ended_at=is.null`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ended_at: new Date().toISOString() }),
    }
  );
  if (!res.ok) throw await restError(res, "Checking out");
  return ((await res.json()) as ShiftRow[]).length > 0;
}
