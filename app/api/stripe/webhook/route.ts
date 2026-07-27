import { NextRequest, NextResponse } from "next/server";
import { finalizeBookingPayment, getBooking, logActivity } from "@/lib/db";
import { notifyBookingConfirmed } from "@/lib/sms";
import { stripeConfigured, verifyStripeWebhook, webhookConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// Stripe calls this when a checkout completes; it's the reliable path that
// finalizes a booking even if the customer never returns to the site.
// Endpoint to register in Stripe: POST /api/stripe/webhook, event
// checkout.session.completed.
export async function POST(req: NextRequest) {
  if (!stripeConfigured() || !webhookConfigured()) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  const payload = await req.text();
  if (!verifyStripeWebhook(payload, req.headers.get("stripe-signature"))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object ?? {};
    const bookingId = (session.metadata as Record<string, string> | undefined)?.bookingId;
    if (session.payment_status === "paid" && bookingId) {
      try {
        // Text only on the pending→paid transition, so retries can't double-send.
        const wasPending = (await getBooking(bookingId))?.status === "pending";
        const booking = await finalizeBookingPayment(bookingId, (session.amount_total as number | null) ?? 0);
        if (booking) await logActivity("Payment received", `${booking.reference} — paid via Stripe`);
        if (booking && wasPending) await notifyBookingConfirmed(booking, req.nextUrl.origin);
      } catch (err) {
        console.error("webhook finalize failed:", err);
        // 500 makes Stripe retry the delivery later — exactly what we want.
        return NextResponse.json({ error: "Could not record the payment." }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ received: true });
}
