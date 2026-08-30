import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { buildBooking } from "@/lib/create-booking";
import { logActivity, saveBooking, takeVoucherFor } from "@/lib/db";
import { markRewardUsed } from "@/lib/reward-codes";
import { notifyBookingConfirmed } from "@/lib/sms";

export const dynamic = "force-dynamic";

// Staff walk-in bookings: same validation/pricing as the public checkout, but
// tagged source "in_person" so the dashboard can split online vs in-person.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("bookings.create");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const result = await buildBooking(body as Record<string, unknown>, "in_person");
  if (!("error" in result) && !result.booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
    return NextResponse.json({ error: "That session is at a location your account doesn\u2019t cover." }, { status: 403 });
  }
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  // Credit the account that took it, so Reports can say who books what. Online
  // bookings have nobody to credit and leave it unset.
  result.booking.bookedBy = guard.staff.name || guard.staff.email;

  // A gift voucher handed over at the desk is money, not a discount: its
  // balance comes off before the save, exactly as the online checkout does it,
  // so a just-emptied code fails cleanly instead of recording payment that was
  // never captured. Cancelling the booking puts the balance back (returnVoucher
  // in lib/manage-booking.ts reads these same pricing fields).
  const p = result.booking.pricing;
  const wantCents = p.voucherCents ?? 0;
  if (p.voucherCode && wantCents > 0) {
    const takenCents = await takeVoucherFor(result.booking);
    if (takenCents <= 0) {
      return NextResponse.json(
        { error: "That gift voucher could not be applied — its balance may have just been spent. Check it under Promo codes." },
        { status: 409 }
      );
    }
    p.voucherCents = takenCents;
    p.voucherRedeemed = true;
    p.paidCents = p.paidCents - wantCents + takenCents;
    p.balanceCents = p.totalCents - p.paidCents;
  }

  try {
    await saveBooking(result.booking);
  } catch (err) {
    console.error("saving walk-in booking failed:", err);
    return NextResponse.json({ error: "Could not save the booking right now. Please try again." }, { status: 500 });
  }
  const b = result.booking;
  // A 20% reward code spent at the desk is marked used, same as at the online
  // checkout — left active it could be spent again. Best-effort: the booking
  // is already saved. Walk-ins still don't EARN a reward code for the next
  // visit (settleRewardsFor's other half) — that's unchanged, and a decision
  // for the owner rather than a side effect of this route.
  if (b.pricing.rewardCode) {
    try {
      await markRewardUsed(b.pricing.rewardCode, b.id);
    } catch (err) {
      console.error(`could not mark reward ${b.pricing.rewardCode} used on ${b.reference}:`, err);
    }
  }
  // Same confirmation the online customer gets — reference, session details and
  // the link to change or cancel. Best-effort: it never throws, so a texting
  // problem can't lose a booking the desk has already taken. No staff copy;
  // whoever took it is standing right there.
  await notifyBookingConfirmed(b, req.nextUrl.origin, { notifyStaff: false });
  const guests = b.items.reduce((s, i) => s + i.quantity, 0);
  await logActivity(
    "Walk-in booking",
    `${b.reference} — ${b.customer.firstName} ${b.customer.lastName}, ${guests} guest(s) for ${b.items[0]?.roomName}`
  );
  return NextResponse.json({ id: b.id, reference: b.reference }, { status: 201 });
}
