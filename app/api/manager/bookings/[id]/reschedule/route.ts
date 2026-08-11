import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { getBooking } from "@/lib/db";
import { isValidISODate } from "@/lib/format";
import { rescheduleForStaff } from "@/lib/manage-booking";
import { notifyBookingRescheduled } from "@/lib/sms";

export const dynamic = "force-dynamic";

// Move a booking to another slot, optionally another room.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await params;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const date = typeof o.date === "string" ? o.date : "";
  const time = typeof o.time === "string" ? o.time : "";
  if (!isValidISODate(date)) return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return NextResponse.json({ error: "Pick a valid start time." }, { status: 400 });
  }

  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
  if (booking.status === "cancelled") {
    return NextResponse.json({ error: "That booking is cancelled — it can't be moved." }, { status: 400 });
  }

  try {
    const result = await rescheduleForStaff(
      booking,
      { date, time, roomId: typeof o.roomId === "string" && o.roomId ? o.roomId : undefined },
      guard.staff.name || guard.staff.email
    );
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

    if (o.notify !== false) {
      try {
        const moved = result.items[0];
        await notifyBookingRescheduled(
          { ...booking, items: result.items },
          { roomName: moved.roomName, date: moved.date, time: moved.time },
          req.nextUrl.origin
        );
      } catch (err) {
        console.error("reschedule text failed:", err);
      }
    }
    return NextResponse.json({ ok: true, items: result.items });
  } catch (err) {
    console.error("staff reschedule failed:", err);
    return NextResponse.json({ error: "Could not move that booking right now. Please try again." }, { status: 500 });
  }
}
