import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import WalkInWithShift, { type ShiftPerson } from "@/components/manager/WalkInWithShift";
import { listExperiences } from "@/lib/experiences";
import { listStaffMembers, openShifts } from "@/lib/staff-members";
import { shiftMinutes } from "@/lib/staff-types";

export const dynamic = "force-dynamic";

export default async function NewWalkInPage() {
  await requirePermission("bookings.create", "/manager/bookings/new");

  // Who's on, with the rooms they can run — the form highlights them against
  // whichever experience is chosen.
  const [members, open, experiences] = await Promise.all([
    listStaffMembers(),
    openShifts(),
    listExperiences(),
  ]);
  const roomName = new Map(experiences.map((e) => [e.id, e.name]));
  const now = new Date();
  const people: ShiftPerson[] = open.map((s) => {
    const m = members.find((x) => x.id === s.memberId);
    return {
      memberId: s.memberId,
      name: s.memberName,
      location: s.location ?? "Unassigned",
      minutes: shiftMinutes(s, now),
      rooms: (m?.trainedRooms ?? [])
        .map((id) => ({ id, name: roomName.get(id) ?? "" }))
        .filter((r) => r.name),
    };
  });

  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/bookings">← Back to all bookings</Link>
      </p>
      <h1 className="mgr-page-title">New walk-in booking</h1>
      <p className="mgr-page-sub">
        Record a booking taken in person or over the phone. It&apos;s tagged as in-person so you can see the
        split against online bookings on the dashboard.
      </p>
      <WalkInWithShift people={people} />
    </>
  );
}
