import { NextRequest, NextResponse } from "next/server";
import { allowedLocations, apiGuard, hasPermission } from "@/lib/auth";
import { blockedKeysForDate } from "@/lib/blocks";
import { minutesToTime, overlappedBy, remainingSpots } from "@/lib/capacity";
import { bookedCountsForDate, busySessionsForDate } from "@/lib/db";
import { listExperiences } from "@/lib/experiences";
import { isValidISODate } from "@/lib/format";
import { locationHoursMap } from "@/lib/hours";
import { startTimesFor } from "@/lib/schedule";

export const dynamic = "force-dynamic";

// Every session on a date, per room, with blocked/booked flags — powers the
// block-off screen and the move-a-booking picker. Unlike the public
// availability API this ignores the booking window and past times, so staff can
// block, or move a booking to, any date.
//
// Either permission opens it: the block-off screen needs it, and so does the
// move-a-booking picker — moving a booking is not blocking one. It says no more
// than the Calendar already shows either role.
//
// `ignore` is a booking being moved — its own seats are discounted so its
// current slot doesn't show as occupied by itself.
export async function GET(req: NextRequest) {
  const guard = await apiGuard();
  if (guard.response) return guard.response;
  if (!hasPermission(guard.staff, "bookings.view") && !hasPermission(guard.staff, "blocks")) {
    return NextResponse.json({ error: "Your account doesn't have access to that." }, { status: 403 });
  }
  const date = req.nextUrl.searchParams.get("date") ?? "";
  const ignoreId = req.nextUrl.searchParams.get("ignore") ?? "";
  if (!isValidISODate(date)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });

  const [experiences, hoursMap, blocked, booked, busy] = await Promise.all([
    listExperiences({ activeOnly: true }),
    locationHoursMap(),
    blockedKeysForDate(date),
    bookedCountsForDate(date),
    busySessionsForDate(date),
  ]);

  // Seats held by the booking being moved, keyed "roomId|time".
  const ownSeats = new Map<string, number>();
  if (ignoreId) {
    const { getBooking } = await import("@/lib/db");
    const b = await getBooking(ignoreId);
    for (const i of b?.items ?? []) {
      if (i.date !== date) continue;
      ownSeats.set(`${i.roomId}|${i.time}`, i.quantity);
      // Its own session must not make every neighbouring slot look occupied —
      // it's the thing being moved out of the way.
      const list = busy.get(i.roomId);
      if (list) busy.set(i.roomId, list.filter((x) => x.time !== i.time));
    }
  }

  const scope = allowedLocations(guard.staff);
  const visible = scope ? experiences.filter((e) => scope.includes(e.location)) : experiences;
  const rooms = visible.map((exp) => ({
    id: exp.id,
    name: exp.name,
    location: exp.location,
    capacity: exp.capacity,
    times: startTimesFor(exp, date, hoursMap.get(exp.location) ?? null).map((time) => {
      const key = `${exp.id}|${time}`;
      const taken = Math.max(0, (booked.get(key) ?? 0) - (ownSeats.get(key) ?? 0));
      // A game running through this time takes the room, whatever this slot's
      // own count says.
      const clash = overlappedBy(busy.get(exp.id), time, exp.durationMinutes);
      return {
        time,
        blocked: blocked.has(key),
        booked: taken > 0,
        taken,
        remaining: clash ? 0 : remainingSpots(exp, taken),
        busyWith: clash ? `${clash.time}–${minutesToTime(clash.end)}` : null,
      };
    }),
  }));
  return NextResponse.json({ date, rooms });
}
