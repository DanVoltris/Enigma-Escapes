import RequestAlerts, { type AlertRow } from "@/components/manager/RequestAlerts";
import StaffBoard from "@/components/manager/StaffBoard";
import TrainingGrid from "@/components/manager/TrainingGrid";
import { hasPermission, requireStaff } from "@/lib/auth";
import { listExperiences } from "@/lib/experiences";
import { alertRecipients } from "@/lib/request-alerts";
import { listStaff } from "@/lib/staff";
import { listStaffMembers, openShifts, recentShifts } from "@/lib/staff-members";
import { formatDuration, shiftMinutes } from "@/lib/staff-types";
import { todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";

// Checking in is open to anyone signed in — the whole point is that the login
// is shared, so gating it behind staff administration would defeat it. Editing
// the roster and the training grid still needs the staff permission.
export default async function ManagerStaff() {
  const session = await requireStaff("/manager/staff");
  const canManage = hasPermission(session, "staff");
  // Who gets texted about booking requests is manager work, not account admin —
  // its own permission, held by managers and admins alike.
  const canEditAlerts = hasPermission(session, "alerts");

  const [members, open, recent, experiences, accounts] = await Promise.all([
    listStaffMembers(),
    openShifts(),
    recentShifts(),
    listExperiences(),
    canEditAlerts ? listStaff() : Promise.resolve([]),
  ]);
  // Counted by the same function that addresses the texts, so the figure on the
  // screen can't drift from who actually gets one.
  const beingTexted = canEditAlerts ? (await alertRecipients()).length : 0;

  // The alert list: manager/admin accounts first (always on), then the roster.
  const ROLE_LABEL: Record<string, string> = { admin: "Admin", manager: "Manager" };
  const alertRows: AlertRow[] = [
    ...accounts
      .filter((a) => a.active && (a.role === "admin" || a.role === "manager"))
      .map((a) => ({
        id: a.id,
        name: a.name,
        role: ROLE_LABEL[a.role] ?? null,
        phone: a.phone ?? "",
        on: true,
        locked: true,
        source: "account" as const,
      })),
    ...members
      .filter((m) => m.active)
      .map((m) => ({
        id: m.id,
        name: m.name,
        role: null,
        phone: m.phone ?? "",
        on: m.requestAlerts,
        locked: false,
        source: "roster" as const,
      })),
  ];

  const rooms = experiences
    .filter((e) => e.active)
    .map((e) => ({ id: e.id, name: e.name, location: e.location }));
  const locations = [...new Set(rooms.map((r) => r.location))].sort();

  const now = new Date();
  const onShift = open.map((s) => ({
    memberId: s.memberId,
    memberName: s.memberName,
    location: s.location,
    minutes: shiftMinutes(s, now),
  }));

  // Hours worked today, closed shifts and open ones alike.
  const today = todayISO();
  const todays = recent.filter((s) => s.startedAt.slice(0, 10) === today);
  const byPerson = new Map<string, { name: string; minutes: number; shifts: number }>();
  for (const s of todays) {
    const row = byPerson.get(s.memberId) ?? { name: s.memberName, minutes: 0, shifts: 0 };
    row.minutes += shiftMinutes(s, now);
    row.shifts += 1;
    byPerson.set(s.memberId, row);
  }
  const hours = [...byPerson.values()].sort((a, b) => b.minutes - a.minutes);

  return (
    <>
      <h1 className="mgr-page-title">Staff</h1>
      <p className="mgr-page-sub">
        Who is on shift, and which rooms each person can run. Everyone shares a login, so check in under your own name.
      </p>

      <StaffBoard
        members={members}
        onShift={onShift}
        rooms={rooms}
        locations={locations}
        canManage={canManage}
      />

      <div className="mgr-card">
        <h2>Hours today</h2>
        {hours.length === 0 ? (
          <p className="mgr-empty">Nobody has checked in today.</p>
        ) : (
          <ul className="shift-list">
            {hours.map((h) => (
              <li key={h.name}>
                <span className="who">{h.name}</span>
                <span className="rooms">
                  {h.shifts} shift{h.shifts === 1 ? "" : "s"}
                </span>
                <span className="mins">{formatDuration(h.minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canEditAlerts && <RequestAlerts rows={alertRows} beingTexted={beingTexted} />}

      {canManage && <TrainingGrid members={members} rooms={rooms} />}
    </>
  );
}
