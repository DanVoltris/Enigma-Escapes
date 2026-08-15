// Types and pure helpers for the staff roster, importable from the browser.
// lib/staff-members.ts reaches the database and must never be pulled into a
// client bundle (it drags in the local file store, and with it `fs`).

export type StaffMember = {
  id: string;
  name: string;
  homeLocation: string | null; // null = works at both sites
  trainedRooms: string[]; // experience ids
  active: boolean;
  phone: string | null; // for booking-request alerts; null = never given one
  requestAlerts: boolean; // texted when a request lands
};

export type Shift = {
  id: string;
  memberId: string;
  memberName: string;
  location: string | null;
  startedAt: string;
  endedAt: string | null;
};

export function shiftMinutes(s: Shift, now = new Date()): number {
  const end = s.endedAt ? new Date(s.endedAt) : now;
  return Math.max(0, Math.round((end.getTime() - new Date(s.startedAt).getTime()) / 60000));
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
