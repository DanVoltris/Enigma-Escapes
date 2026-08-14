import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { listExperiences } from "@/lib/experiences";
import { isValidISODate, todayISO } from "@/lib/format";
import { locationHoursMap } from "@/lib/hours";
import { startTimesFor } from "@/lib/schedule";

export const dynamic = "force-dynamic";

// Fuller experience list for the walk-in form (needs times, price, capacity).
//
// Start times are worked out for a specific date, through the same
// startTimesFor() the customer site and the calendar use. Returning the raw
// `times` column instead — as this did — showed the desk a room's fallback
// list rather than its real schedule: every room offered 11:00, 13:00, 15:00…
// while the site was selling 11:00, 12:30, 14:00… plus later slots on Fridays
// and Saturdays. Anything booked off that list landed off-grid.
export async function GET(req: NextRequest) {
  const guard = await apiGuard();
  if (guard.response) return guard.response;

  const asked = req.nextUrl.searchParams.get("date");
  const date = asked && isValidISODate(asked) ? asked : todayISO();

  try {
    const [experiences, hoursMap] = await Promise.all([
      listExperiences({ activeOnly: true }),
      locationHoursMap(),
    ]);
    return NextResponse.json({
      date,
      experiences: experiences.map((e) => ({
        id: e.id,
        name: e.name,
        location: e.location,
        priceCents: e.priceCents,
        capacity: e.capacity,
        times: startTimesFor(e, date, hoursMap.get(e.location) ?? null),
      })),
    });
  } catch (err) {
    console.error("manager experiences list failed:", err);
    return NextResponse.json({ error: "Could not load experiences." }, { status: 500 });
  }
}
