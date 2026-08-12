import { listExperiences } from "@/lib/experiences";
import { listStaffMembers, openShifts } from "@/lib/staff-members";
import { formatDuration, shiftMinutes } from "@/lib/staff-types";
import Link from "next/link";

// Who's on right now and which rooms they can run — shown while taking a
// walk-in so the desk can answer "can we actually run that room?" without
// leaving the form. Server component: it fetches its own data.
export default async function OnShiftPanel() {
  const [members, open, experiences] = await Promise.all([
    listStaffMembers(),
    openShifts(),
    listExperiences(),
  ]);
  const roomName = new Map(experiences.map((e) => [e.id, e.name]));
  const now = new Date();

  const byLocation = new Map<string, { name: string; minutes: number; rooms: string[] }[]>();
  for (const s of open) {
    const m = members.find((x) => x.id === s.memberId);
    const key = s.location ?? "Unassigned";
    const list = byLocation.get(key) ?? [];
    list.push({
      name: s.memberName,
      minutes: shiftMinutes(s, now),
      rooms: (m?.trainedRooms ?? []).map((id) => roomName.get(id)).filter((n): n is string => Boolean(n)),
    });
    byLocation.set(key, list);
  }

  return (
    <div className="mgr-card">
      <h2>On shift now</h2>
      {open.length === 0 ? (
        <p className="mgr-empty">
          Nobody is checked in. <Link href="/manager/staff">Check in on the Staff tab</Link>.
        </p>
      ) : (
        <div className="onshift-cols">
          {[...byLocation.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([loc, people]) => (
              <div key={loc}>
                <h3 className="intg-subhead">{loc}</h3>
                <ul className="shift-list compact">
                  {people.map((p) => (
                    <li key={p.name}>
                      <span className="who">{p.name}</span>
                      <span className="rooms">{p.rooms.length > 0 ? p.rooms.join(", ") : "no rooms recorded"}</span>
                      <span className="mins">{formatDuration(p.minutes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
