import { NextRequest, NextResponse } from "next/server";
import { slotsForDate } from "@/lib/availability";
import { recordEvent, VISITOR_COOKIE, type LookRoom } from "@/lib/events";
import { addDaysISO, isValidISODate, todayISO } from "@/lib/format";
import { sweepIfDue } from "@/lib/request-flow";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? "";

  if (!isValidISODate(date)) {
    return NextResponse.json(
      { error: "Invalid date. Use the format YYYY-MM-DD." },
      { status: 400 }
    );
  }

  const today = todayISO();
  const { windowDays } = await getSiteSettings();
  const lastBookable = addDaysISO(today, windowDays);
  if (date < today || date > lastBookable) {
    return NextResponse.json(
      { error: `Bookings are only available from today up to ${windowDays} days ahead.` },
      { status: 400 }
    );
  }

  try {
    // Piggy-backs the reminder/release timer on ordinary traffic — see
    // sweepIfDue. Not awaited: availability must not wait on texting.
    void sweepIfDue(req.nextUrl.origin);
    const slots = await slotsForDate(date);
    // What was asked for and what was left — the record of demand the venue
    // couldn't serve. Fire-and-forget, like the sweep: the lookup never waits
    // on analytics, and a failed write is logged, not surfaced.
    const rooms = new Map<string, LookRoom>();
    for (const s of slots) {
      const r = rooms.get(s.roomId) ?? { roomId: s.roomId, roomName: s.roomName, location: s.location, shown: 0, bookable: 0 };
      r.shown++;
      if (s.remaining > 0) r.bookable++;
      rooms.set(s.roomId, r);
    }
    void recordEvent(
      "availability_look",
      { date, rooms: Array.from(rooms.values()) },
      { visitor: req.cookies.get(VISITOR_COOKIE)?.value ?? null, path: "/" }
    );
    return NextResponse.json({ date, slots });
  } catch (err) {
    console.error("availability lookup failed:", err);
    return NextResponse.json(
      { error: "Could not load availability right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
