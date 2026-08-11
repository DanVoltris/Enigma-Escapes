import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { getBooking } from "@/lib/db";
import { cancelForStaff } from "@/lib/manage-booking";
import { notifyBookingCancelled } from "@/lib/sms";

export const dynamic = "force-dynamic";

// Staff cancel a booking and decide the refund: all of it, part of it, or
// none. No 24-hour cutoff here — that rule governs customers cancelling
// themselves, not the team handling a phone call.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await params;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
  if (booking.status === "cancelled") {
    return NextResponse.json({ error: "That booking is already cancelled." }, { status: 400 });
  }

  const paid = booking.pricing.paidCents;
  const mode = o.refund === "full" || o.refund === "partial" || o.refund === "none" ? o.refund : null;
  if (!mode) return NextResponse.json({ error: "Choose a refund option." }, { status: 400 });

  let refundCents = 0;
  if (mode === "full") refundCents = paid;
  if (mode === "partial") {
    const dollars = typeof o.amount === "number" ? o.amount : Number(o.amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return NextResponse.json({ error: "Enter how much to refund." }, { status: 400 });
    }
    refundCents = Math.round(dollars * 100);
    if (refundCents > paid) {
      return NextResponse.json(
        { error: `They only paid $${(paid / 100).toFixed(2)} — you can't refund more than that.` },
        { status: 400 }
      );
    }
  }

  try {
    const outcome = await cancelForStaff(booking, refundCents, guard.staff.name || guard.staff.email);
    if (o.notify !== false) {
      // Never let a texting problem hide a completed cancellation.
      try {
        await notifyBookingCancelled(outcome.booking);
      } catch (err) {
        console.error("cancellation text failed:", err);
      }
    }
    return NextResponse.json({
      ok: true,
      refundedCents: outcome.refundedCents,
      owedCents: outcome.owedCents,
    });
  } catch (err) {
    console.error("staff cancel failed:", err);
    return NextResponse.json({ error: "Could not cancel that booking right now. Please try again." }, { status: 500 });
  }
}
