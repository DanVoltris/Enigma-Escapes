import { NextRequest, NextResponse } from "next/server";
import { getBooking, getPromo, logActivity, updateBookingFields } from "@/lib/db";
import { computeTotals } from "@/lib/pricing";
import { activeTaxPercent } from "@/lib/taxes";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

// Recompute a booking's pricing for a given discount, keeping what was already
// paid. Tax uses the current configured rate (staff is editing the booking now).
async function repriced(booking: Booking, percentOff: number): Promise<Booking["pricing"]> {
  const taxPercent = await activeTaxPercent();
  const totals = computeTotals(booking.items, percentOff, taxPercent);
  return {
    ...booking.pricing,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    gstCents: totals.gstCents,
    totalCents: totals.totalCents,
    balanceCents: totals.totalCents - booking.pricing.paidCents,
  };
}

// Apply a promo code to an existing booking.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const code = String((body as { code?: unknown }).code ?? "").trim().toUpperCase();
  if (!code || code.length > 40) {
    return NextResponse.json({ error: "Choose a promo code to apply." }, { status: 400 });
  }

  try {
    const booking = await getBooking(id);
    if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
    if (booking.promoCode) {
      return NextResponse.json(
        { error: `Promo ${booking.promoCode} is already applied. Remove it first.` },
        { status: 409 }
      );
    }
    const promo = await getPromo(code);
    if (!promo || !promo.active) {
      return NextResponse.json({ error: "That code is not valid or is inactive." }, { status: 404 });
    }

    const pricing = await repriced(booking, promo.percentOff);
    await updateBookingFields(id, { pricing, promoCode: promo.code });
    await logActivity("Applied promo", `${promo.code} (${promo.percentOff}% off) to ${booking.reference}`);
    return NextResponse.json({ ok: true, pricing, promoCode: promo.code });
  } catch (err) {
    console.error("applying promo failed:", err);
    return NextResponse.json({ error: "Could not apply the code right now. Please try again." }, { status: 500 });
  }
}

// Remove the promo from a booking and restore undiscounted pricing.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const booking = await getBooking(id);
    if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
    if (!booking.promoCode) {
      return NextResponse.json({ error: "This booking has no promo applied." }, { status: 400 });
    }

    const removed = booking.promoCode;
    const pricing = await repriced(booking, 0);
    await updateBookingFields(id, { pricing, promoCode: null });
    await logActivity("Removed promo", `${removed} from ${booking.reference}`);
    return NextResponse.json({ ok: true, pricing, promoCode: null });
  } catch (err) {
    console.error("removing promo failed:", err);
    return NextResponse.json({ error: "Could not remove the code right now. Please try again." }, { status: 500 });
  }
}
