import { NextRequest, NextResponse } from "next/server";
import { ATTRIBUTION_COOKIE, attributionFromCookie } from "@/lib/attribution";
import { buildBooking } from "@/lib/create-booking";
import { saveBooking, takeVoucherFor } from "@/lib/db";
import { getRequestByToken, setRequestStatus } from "@/lib/requests";
import { settleRewardsFor } from "@/lib/reward-flow";
import { notifyBookingConfirmed } from "@/lib/sms";
import { pushOnlineBooking } from "@/lib/staff-push";
import { stripeConfigured } from "@/lib/stripe";
import { refundToVoucher } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // This is the simulated checkout: it saves the booking as paid with nobody
  // charged. Once a venue has Stripe keys, every booking — voucher-only ones
  // included — goes through /api/checkout/session instead, so a request here
  // is someone replaying the old form to get a free booking.
  if (stripeConfigured()) {
    return NextResponse.json(
      { error: "Online payment has moved to secure checkout. Please refresh the payment page and try again." },
      { status: 409 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // Where they came from rides in on the first-touch cookie, not the body: the
  // page never sees it, so it can't be forged as part of the request.
  const attribution = attributionFromCookie(req.cookies.get(ATTRIBUTION_COOKIE)?.value);
  const result = await buildBooking({ ...(body as Record<string, unknown>), attribution }, "online");
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  // Nothing goes through Stripe on this path, so the booking counts as paid the
  // moment it is saved — take the voucher balance now. Before the save, so a
  // code that has just been emptied elsewhere fails checkout cleanly rather
  // than confirming a booking nobody paid for.
  const p = result.booking.pricing;
  const wantCents = p.voucherCents ?? 0;
  if (p.voucherCode && wantCents > 0) {
    const takenCents = await takeVoucherFor(result.booking);
    if (takenCents <= 0) {
      return NextResponse.json(
        { error: "That gift voucher could not be applied. Nothing has been charged — please check the code." },
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
    console.error("saving booking failed:", err);
    // The voucher was spent above, but there is no booking to show for it, so
    // the balance goes back — otherwise the retry we ask for finds it empty.
    if (p.voucherRedeemed && p.voucherCode && (p.voucherCents ?? 0) > 0) {
      const back = await refundToVoucher(p.voucherCode, p.voucherCents ?? 0).catch(() => false);
      if (!back) {
        console.error(
          `$${((p.voucherCents ?? 0) / 100).toFixed(2)} was taken from voucher ${p.voucherCode} for ` +
            `${result.booking.reference}, which never saved — put it back on the voucher by hand.`
        );
      }
    }
    return NextResponse.json(
      { error: "Could not save your booking right now. You have not been charged — please try again shortly." },
      { status: 500 }
    );
  }
  await notifyBookingConfirmed(result.booking, req.nextUrl.origin); // best-effort; never throws
  pushOnlineBooking(result.booking, req.nextUrl.origin);
  await settleRewardsFor(result.booking); // spends any reward used, issues the next one

  // An accepted request that just completed checkout gets closed out.
  const token = (body as { requestToken?: unknown }).requestToken;
  if (typeof token === "string" && token) {
    try {
      const request = await getRequestByToken(token);
      if (request && request.status === "accepted") await setRequestStatus(request.id, "completed", result.booking.id);
    } catch (err) {
      console.error("closing request after booking failed:", err); // booking still stands
    }
  }
  return NextResponse.json({ id: result.booking.id, reference: result.booking.reference }, { status: 201 });
}
