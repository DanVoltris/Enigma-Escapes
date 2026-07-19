import { NextRequest, NextResponse } from "next/server";
import { slotsForDate } from "@/lib/availability";
import { addDaysISO, isValidISODate, todayISO } from "@/lib/format";
import { BOOKING_WINDOW_DAYS } from "@/lib/pricing";

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
  const lastBookable = addDaysISO(today, BOOKING_WINDOW_DAYS);
  if (date < today || date > lastBookable) {
    return NextResponse.json(
      { error: `Bookings are only available from today up to ${BOOKING_WINDOW_DAYS} days ahead.` },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json({ date, slots: await slotsForDate(date) });
  } catch (err) {
    console.error("availability lookup failed:", err);
    return NextResponse.json(
      { error: "Could not load availability right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
