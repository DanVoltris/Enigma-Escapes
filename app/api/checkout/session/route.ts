import { NextRequest, NextResponse } from "next/server";
import { buildBooking } from "@/lib/create-booking";
import { getRequestByToken, setRequestStatus } from "@/lib/requests";
import { finalizeBookingPayment, logActivity, saveBooking } from "@/lib/db";
import { getLocale } from "@/lib/locale";
import { createCheckoutSession, PENDING_MINUTES, stripeConfigured } from "@/lib/stripe";

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

  const result = await buildBooking(body as Record<string, unknown>, "online");
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
  // there is no Stripe session to make. Finalize it here instead — that spends
  // the voucher and marks the booking paid through the same idempotent path.
  if (dueCents <= 0) {
    try {
      await saveBooking(booking);
      await finalizeBookingPayment(booking.id, 0);
      await logActivity("Booking paid by gift voucher", `${booking.reference} — no card payment needed`);
      await closeRequest(body, booking.id);
    } catch (err) {
      console.error("finalizing voucher-only booking failed:", err);
      return NextResponse.json(
        { error: "Could not complete the booking right now. You have not been charged — please try again shortly." },
        { status: 500 }
      );
    }
    return NextResponse.json({ url: `${req.nextUrl.origin}/confirmation/${booking.id}` }, { status: 201 });
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
    return NextResponse.json({ url: session.url }, { status: 201 });
  } catch (err) {
    console.error("creating Stripe checkout session failed:", err);
    return NextResponse.json(
      { error: "Could not reach the payment provider. You have not been charged — please try again shortly." },
      { status: 502 }
    );
  }
}
