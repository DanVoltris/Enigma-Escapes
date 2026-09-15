import { NextRequest, NextResponse } from "next/server";
import { ATTRIBUTION_COOKIE, attributionFromCookie } from "@/lib/attribution";
import { buildBooking } from "@/lib/create-booking";
import { getRequestByToken, setRequestStatus } from "@/lib/requests";
import { getBooking, logActivity, releasePendingBooking, saveBooking, takeVoucherFor } from "@/lib/db";
import { getLocale } from "@/lib/locale";
import { settleRewardsFor } from "@/lib/reward-flow";
import { notifyBookingConfirmed } from "@/lib/sms";
import { pushOnlineBooking } from "@/lib/staff-push";
import {
  createCheckoutSession,
  expireCheckoutSession,
  PENDING_MINUTES,
  retrieveCheckoutSession,
  stripeConfigured,
} from "@/lib/stripe";
import { refundToVoucher } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

// Starts a Stripe checkout: validates the cart exactly like a normal booking,
// saves it as "pending" (holding its spots for PENDING_MINUTES), and returns
// the Stripe-hosted payment URL to redirect to.

// An accepted request that reached checkout gets linked to its booking and
// closed. The simulated flow always did this; with Stripe live it never
// happened, so the Requests screen showed every accepted request as if the
// customer had vanished — including the ones who had paid minutes earlier.
// Linked at session creation rather than at payment: the booking already holds
// the slot, and if the checkout lapses the request has expired anyway.
async function closeRequest(body: unknown, bookingId: string): Promise<void> {
  const token = (body as { requestToken?: unknown }).requestToken;
  if (typeof token !== "string" || !token) return;
  try {
    const request = await getRequestByToken(token);
    if (request && request.status === "accepted") await setRequestStatus(request.id, "completed", bookingId);
  } catch (err) {
    console.error("closing request after checkout failed:", err); // the booking still stands
  }
}

// Puts voucher money back when the booking it was taken for didn't happen.
async function putBackOnVoucher(code: string | null | undefined, cents: number, reference: string): Promise<void> {
  if (!code || cents <= 0) return;
  try {
    if (await refundToVoucher(code, cents)) return;
  } catch (err) {
    console.error(`returning money to voucher ${code} failed:`, err);
  }
  console.error(
    `${reference} was not booked, but $${(cents / 100).toFixed(2)} taken from voucher ${code} could not be put back — add it back by hand.`
  );
}

// The customer's own earlier try at this checkout: they backed out of Stripe's
// page and pressed Pay again. That attempt's pending booking still holds the
// slot, so without this the retry was refused as "already booked" — by their
// own hold — for PENDING_MINUTES. The cart sends back the booking and session
// it started (both secrets only that browser has), and the hold is let go only
// once Stripe confirms the old session can no longer be paid, so it can't come
// back later as a second booking for the same slot.
//
// Returns a response only when the old session turns out to have been paid:
// the customer belongs on its confirmation page, not in a second checkout.
async function releaseEarlierAttempt(body: unknown, origin: string): Promise<NextResponse | null> {
  const held = (body as { heldCheckout?: { bookingId?: unknown; sessionId?: unknown } | null }).heldCheckout;
  if (!held || typeof held.bookingId !== "string" || typeof held.sessionId !== "string") return null;
  try {
    const earlier = await getBooking(held.bookingId);
    if (!earlier || earlier.status !== "pending") return null;
    const session = await retrieveCheckoutSession(held.sessionId);
    if (session.metadata?.bookingId !== earlier.id) return null;
    if (!(await expireCheckoutSession(session.id))) {
      return NextResponse.json(
        { url: `${origin}/confirmation/${earlier.id}?sid=${encodeURIComponent(session.id)}` },
        { status: 201 }
      );
    }
    await releasePendingBooking(earlier.id);
    // Starting that checkout closed the customer's accepted request; reopen it,
    // or the retry is refused for not having one.
    const token = (body as { requestToken?: unknown }).requestToken;
    if (typeof token === "string" && token) {
      const request = await getRequestByToken(token);
      if (request && request.status === "completed" && request.bookingId === earlier.id) {
        await setRequestStatus(request.id, "accepted");
      }
    }
  } catch (err) {
    // Validation below still decides; at worst the old hold refuses the retry
    // the way it did before.
    console.error("releasing the earlier checkout attempt failed:", err);
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Online card payment isn't configured yet. Set STRIPE_SECRET_KEY in the environment." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // Same first-touch cookie the simulated checkout reads — a booking paid
  // through Stripe should be credited to its source just the same.
  const attribution = attributionFromCookie(req.cookies.get(ATTRIBUTION_COOKIE)?.value);
  const alreadyPaid = await releaseEarlierAttempt(body, req.nextUrl.origin);
  if (alreadyPaid) return alreadyPaid;
  const result = await buildBooking({ ...(body as Record<string, unknown>), attribution }, "online");
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  // buildBooking assumes immediate payment; hold the spots unpaid instead.
  // Only the card's share goes to Stripe — the voucher part is already paid
  // for, and is taken off the balance when the payment is confirmed.
  const dueCents = result.booking.pricing.paidCents - (result.booking.pricing.voucherCents ?? 0);
  const booking = {
    ...result.booking,
    status: "pending" as const,
    pendingExpiresAt: new Date(Date.now() + PENDING_MINUTES * 60 * 1000).toISOString(),
    pricing: {
      ...result.booking.pricing,
      paidCents: 0,
      balanceCents: result.booking.pricing.totalCents,
    },
  };

  // A voucher big enough to cover everything due leaves nothing to charge, so
  // there is no Stripe session to make and nothing to wait for. It is saved the
  // way the simulated checkout saves: the voucher is taken first, and the
  // booking only exists if it still covers what's due. Saving it pending and
  // claiming it paid before spending confirmed bookings whose voucher had just
  // been used in another tab — paid, texted and rewarded with nothing collected.
  if (dueCents <= 0) {
    const paid = result.booking;
    const code = paid.pricing.voucherCode;
    const wantCents = paid.pricing.voucherCents ?? 0;
    const takenCents = await takeVoucherFor(paid);
    if (takenCents < wantCents) {
      await putBackOnVoucher(code, takenCents, paid.reference);
      return NextResponse.json(
        {
          error:
            "That gift voucher no longer covers this booking — its balance may have just been used. " +
            "Nothing has been charged; remove the code and apply it again to see what is left.",
        },
        { status: 409 }
      );
    }
    if (wantCents > 0) paid.pricing.voucherRedeemed = true;
    try {
      await saveBooking(paid);
    } catch (err) {
      console.error("saving voucher-only booking failed:", err);
      await putBackOnVoucher(code, takenCents, paid.reference);
      return NextResponse.json(
        { error: "Could not complete the booking right now. You have not been charged — please try again shortly." },
        { status: 500 }
      );
    }
    try {
      await logActivity("Booking paid by gift voucher", `${paid.reference} — no card payment needed`);
    } catch (err) {
      console.error("logging voucher-only booking failed:", err); // the booking stands
    }
    await closeRequest(body, paid.id);
    // Paid in full by voucher never goes near Stripe, so no webhook will ever
    // send the confirmation text or the staff alert: this is the only chance.
    await notifyBookingConfirmed(paid, req.nextUrl.origin); // best-effort; never throws
    pushOnlineBooking(paid, req.nextUrl.origin);
    await settleRewardsFor(paid); // spends any reward used, issues the next one
    return NextResponse.json({ url: `${req.nextUrl.origin}/confirmation/${paid.id}` }, { status: 201 });
  }

  try {
    await saveBooking(booking);
  } catch (err) {
    console.error("saving pending booking failed:", err);
    return NextResponse.json(
      { error: "Could not start the payment right now. You have not been charged — please try again shortly." },
      { status: 500 }
    );
  }

  try {
    const { currencyCode } = await getLocale();
    const session = await createCheckoutSession(booking, dueCents, currencyCode, req.nextUrl.origin);
    await logActivity("Checkout started", `${booking.reference} — awaiting payment`);
    await closeRequest(body, booking.id);
    // The booking and session come back so the cart can hand them in if the
    // customer backs out and pays again (releaseEarlierAttempt above).
    return NextResponse.json({ url: session.url, bookingId: booking.id, sessionId: session.id }, { status: 201 });
  } catch (err) {
    console.error("creating Stripe checkout session failed:", err);
    // Nobody can pay a session we never handed out, so the hold goes now —
    // left in place it refused every "try again" for PENDING_MINUTES.
    try {
      await releasePendingBooking(booking.id);
    } catch (releaseErr) {
      console.error("releasing the unpaid hold failed:", releaseErr);
    }
    return NextResponse.json(
      { error: "Could not reach the payment provider. You have not been charged — please try again shortly." },
      { status: 502 }
    );
  }
}
