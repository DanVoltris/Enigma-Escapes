import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { getBooking } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { cancelItemForStaff } from "@/lib/manage-booking";
import { refundGoingBackCents } from "@/lib/pricing";

export const dynamic = "force-dynamic";

// Cancel ONE session on a booking that holds several, keeping the rest of the
// reservation. The whole-booking cancel lives next door in cancel/route.ts;
// this one never touches the other rooms.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await params;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
  // Scoped accounts decide nothing about another store's booking — checked
  // across every session, because one reference can span locations.
  if (!booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
    return NextResponse.json({ error: "That booking is at a location your account doesn't cover." }, { status: 403 });
  }
  if (booking.status === "cancelled") {
    return NextResponse.json({ error: "That booking is already cancelled." }, { status: 400 });
  }

  const itemIndex = typeof o.itemIndex === "number" ? o.itemIndex : Number(o.itemIndex);
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= booking.items.length) {
    return NextResponse.json({ error: "Choose which session to cancel." }, { status: 400 });
  }

  // What is left to give back: money already promised by an earlier refund
  // isn't available to promise again.
  const refundable = Math.max(0, booking.pricing.paidCents - refundGoingBackCents(booking.pricing));
  const mode = o.refund === "share" || o.refund === "partial" || o.refund === "none" ? o.refund : null;
  if (!mode) return NextResponse.json({ error: "Choose a refund option." }, { status: 400 });

  let refundCents = 0;
  if (mode === "share") {
    // The caller says what this room's share came to; the server still caps it
    // at what can actually go back.
    const dollars = typeof o.amount === "number" ? o.amount : Number(o.amount);
    if (!Number.isFinite(dollars) || dollars < 0) {
      return NextResponse.json({ error: "Enter how much to refund." }, { status: 400 });
    }
    refundCents = Math.min(Math.round(dollars * 100), refundable);
  }
  if (mode === "partial") {
    const dollars = typeof o.amount === "number" ? o.amount : Number(o.amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return NextResponse.json({ error: "Enter how much to refund." }, { status: 400 });
    }
    refundCents = Math.round(dollars * 100);
    if (refundCents > refundable) {
      return NextResponse.json(
        { error: `There is only ${formatMoney(refundable)} left to refund on this booking.` },
        { status: 400 }
      );
    }
  }

  try {
    const out = await cancelItemForStaff(booking, itemIndex, refundCents, guard.staff.name || guard.staff.email);
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
    return NextResponse.json({
      ok: true,
      removed: out.removed,
      remaining: out.items.length,
      totalCents: out.pricing.totalCents,
      balanceCents: out.pricing.balanceCents,
      refundedCents: out.refundedCents,
      owedCents: out.owedCents,
    });
  } catch (err) {
    console.error("staff session cancel failed:", err);
    return NextResponse.json(
      { error: "Could not cancel that session right now. Please try again." },
      { status: 500 }
    );
  }
}
