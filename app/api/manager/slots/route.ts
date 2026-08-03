import { NextRequest, NextResponse } from "next/server";
import { blockedKeysForDate } from "@/lib/blocks";
import { bookedCountsForDate } from "@/lib/db";
import { listExperiences } from "@/lib/experiences";
import { isValidISODate } from "@/lib/format";
import { locationHoursMap } from "@/lib/hours";
import { startTimesFor } from "@/lib/schedule";

export const dynamic = "force-dynamic";

// Every session on a date, per room, with blocked/booked flags — powers the
// block-off screen. Unlike the public availability API this ignores the
// booking window and past times, so staff can block any date.
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!isValidISODate(date)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });

  const [experiences, hoursMap, blocked, booked] = await Promise.all([
    listExperiences({ activeOnly: true }),
    locationHoursMap(),
    blockedKeysForDate(date),
    bookedCountsForDate(date),
  ]);

  const rooms = experiences.map((exp) => ({
    id: exp.id,
    name: exp.name,
    location: exp.location,
    times: startTimesFor(exp, date, hoursMap.get(exp.location) ?? null).map((time) => ({
      time,
      blocked: blocked.has(`${exp.id}|${time}`),
      booked: (booked.get(`${exp.id}|${time}`) ?? 0) > 0,
    })),
  }));
  return NextResponse.json({ date, rooms });
}
