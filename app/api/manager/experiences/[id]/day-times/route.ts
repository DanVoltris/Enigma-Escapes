import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { bookingsForRoomOnDate, logActivity } from "@/lib/db";
import { getExperience, updateExperience } from "@/lib/experiences";
import { formatDateLong, formatTime, isValidISODate } from "@/lib/format";
import { getLocationHours } from "@/lib/hours";
import { startTimesFor } from "@/lib/schedule";
import { withDay } from "@/lib/time-periods";

export const dynamic = "force-dynamic";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// The start times one room runs on one date, and what changing them would cost.
//
// `normal` is what the weekday's schedule gives; `times` is what the date
// actually runs (the same thing unless the date has been given its own list).
// `booked` is what can't be taken away without stranding somebody.
async function readDay(id: string, date: string) {
  const exp = await getExperience(id);
  if (!exp) return null;
  const hours = exp.scheduleMode === "store" ? await getLocationHours(exp.location) : null;
  const times = startTimesFor(exp, date, hours);
  // What the date runs without its own single-day entry — the usual times, or a
  // longer stretch of different times it sits inside. (dateTimes is the older
  // home for a day's list; anything there is moved out when the day is saved.)
  const otherDates = Object.fromEntries(Object.entries(exp.dateTimes ?? {}).filter(([d]) => d !== date));
  const normal = startTimesFor({ ...exp, dateTimes: otherDates, timePeriods: withDay(exp.timePeriods, date, null) }, date, hours);
  const bookings = await bookingsForRoomOnDate(id, date);
  const booked = bookings.flatMap((b) =>
    b.items
      .filter((i) => i.roomId === id && i.date === date)
      .map((i) => ({ time: i.time, reference: b.reference, guests: i.quantity, bookingId: b.id }))
  );
  const custom =
    Boolean(exp.dateTimes?.[date]?.length) || (exp.timePeriods ?? []).some((p) => p.from === date && p.to === date);
  return { exp, times, normal, booked, custom };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("experiences");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!isValidISODate(date)) return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });

  const day = await readDay(id, date);
  if (!day) return NextResponse.json({ error: "That room no longer exists." }, { status: 404 });
  if (!canSeeLocation(guard.staff, day.exp.location)) {
    return NextResponse.json({ error: "That room is at a location your account doesn't cover." }, { status: 403 });
  }
  return NextResponse.json({
    date,
    roomName: day.exp.name,
    durationMinutes: day.exp.durationMinutes,
    times: day.times,
    normal: day.normal,
    booked: day.booked,
    custom: day.custom,
  });
}

// Set (or clear) the times this one date runs. `times: null` puts the date back
// on the weekday's normal schedule.
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("experiences");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;

  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const date = typeof raw.date === "string" ? raw.date : "";
  if (!isValidISODate(date)) return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });

  const clearing = raw.times === null;
  let times: string[] = [];
  if (!clearing) {
    if (!Array.isArray(raw.times)) return NextResponse.json({ error: "Send the day's start times." }, { status: 400 });
    times = [...new Set(raw.times.filter((t): t is string => typeof t === "string"))].sort();
    if (times.some((t) => !TIME_RE.test(t))) {
      return NextResponse.json({ error: "Every start time must be a 24-hour HH:MM." }, { status: 400 });
    }
    if (times.length === 0) {
      return NextResponse.json(
        { error: "Leave at least one start time, or put the day back to normal." },
        { status: 400 }
      );
    }
  }

  const day = await readDay(id, date);
  if (!day) return NextResponse.json({ error: "That room no longer exists." }, { status: 404 });
  if (!canSeeLocation(guard.staff, day.exp.location)) {
    return NextResponse.json({ error: "That room is at a location your account doesn't cover." }, { status: 403 });
  }

  // Whatever the day would run afterwards has to still cover every booking on
  // it. This is the whole point of the guard: a booked time quietly dropped off
  // the list is a group that turns up to a session nobody can see.
  const after = clearing ? day.normal : times;
  const stranded = day.booked.filter((b) => !after.includes(b.time));
  if (stranded.length > 0) {
    const list = stranded.map((b) => `${formatTime(b.time)} (${b.reference})`).join(", ");
    return NextResponse.json(
      {
        error:
          `${stranded.length === 1 ? "A session is" : "Sessions are"} booked at ${list}. ` +
          `Move or cancel ${stranded.length === 1 ? "it" : "them"} first — dropping the time would leave ` +
          `${stranded.length === 1 ? "that group" : "those groups"} with nothing on the calendar.`,
      },
      { status: 409 }
    );
  }

  // Saved as a one-day entry in the room's "different times for some dates",
  // so the room page lists it alongside the longer stretches.
  const dateTimes = { ...(day.exp.dateTimes ?? {}) };
  delete dateTimes[date];
  const timePeriods = withDay(day.exp.timePeriods, date, clearing ? null : times);

  try {
    await updateExperience(id, { dateTimes, timePeriods });
    await logActivity(
      clearing ? "Day's times put back to normal" : "Day's times changed",
      `${day.exp.name} — ${formatDateLong(date)}` +
        (clearing ? "" : ` — ${times.map(formatTime).join(", ")}`)
    );
    return NextResponse.json({ ok: true, times: clearing ? day.normal : times, custom: !clearing });
  } catch (err) {
    console.error("saving a day's times failed:", err);
    return NextResponse.json({ error: "Could not save that. Try again shortly." }, { status: 500 });
  }
}
