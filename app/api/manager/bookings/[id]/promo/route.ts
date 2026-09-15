import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { getPricingMode } from "@/lib/pricing-settings";
import { getBooking, getPromo, logActivity, updateBookingFields } from "@/lib/db";
import { computeTotals } from "@/lib/pricing";
import { getRewardCode } from "@/lib/reward-codes";
import { activeTaxPercent } from "@/lib/taxes";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

// Recompute a booking's pricing for a given discount, keeping what was already
// paid. Tax uses the current configured rate (staff is editing the booking now).
async function repriced(booking: Booking, percentOff: number, feeDiscountable = true): Promise<Booking["pricing"]> {
  const taxPercent = await activeTaxPercent();
  const totals = computeTotals(
    booking.items,
    percentOff,
    taxPercent,
    await getPricingMode(),
    booking.pricing.flatFeeCents ?? 0,
    feeDiscountable // a promo applied by hand has the same reach as one typed at checkout
  );
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
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
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
    if (!booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
      return NextResponse.json({ error: "That booking is at a location your account doesn't cover." }, { status: 403 });
    }
    if (booking.promoCode) {
      return NextResponse.json(
        { error: `Promo ${booking.promoCode} is already applied. Remove it first.` },
        { status: 409 }
      );
    }
    // A booking made with a 20% reward code carries its discount without a
    // promoCode. Repricing for a promo would replace that discount, and the
    // one-time code is already spent. Checkout takes one code or the other, so
    // the desk does too. (A reward voided by a cancellation no longer counts.)
    if (booking.pricing.rewardCode && !booking.pricing.rewardVoidedAt) {
      return NextResponse.json(
        { error: `This booking already has reward code ${booking.pricing.rewardCode} applied — a promo can't be added on top.` },
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
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;
  try {
    const booking = await getBooking(id);
    if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
    if (!booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
      return NextResponse.json({ error: "That booking is at a location your account doesn't cover." }, { status: 403 });
    }
    if (!booking.promoCode) {
      return NextResponse.json({ error: "This booking has no promo applied." }, { status: 400 });
    }

    const removed = booking.promoCode;
    // A promo stacked on a reward booking before that was refused: removing it
    // goes back to the reward's discount, not to full price.
    const reward =
      booking.pricing.rewardCode && !booking.pricing.rewardVoidedAt
        ? await getRewardCode(booking.pricing.rewardCode)
        : undefined;
    const pricing = reward ? await repriced(booking, reward.percentOff, false) : await repriced(booking, 0);
    await updateBookingFields(id, { pricing, promoCode: null });
    await logActivity("Removed promo", `${removed} from ${booking.reference}`);
    return NextResponse.json({ ok: true, pricing, promoCode: null });
  } catch (err) {
    console.error("removing promo failed:", err);
    return NextResponse.json({ error: "Could not remove the code right now. Please try again." }, { status: 500 });
  }
}
