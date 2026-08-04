import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { getBooking, logActivity, updateBookingFields } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { getIntentState, terminalConfigured } from "@/lib/stripe-terminal";
import type { BookingPayment } from "@/lib/types";

export const dynamic = "force-dynamic";

// Polled by the Today screen while the customer is at the reader. The moment
// Stripe says the card went through, the payment is written onto the booking —
// once, no matter how many times this is polled (the intent id is the key).
export async function GET(req: NextRequest) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  if (!terminalConfigured()) return NextResponse.json({ error: "Card terminal isn't set up." }, { status: 400 });

  const intentId = req.nextUrl.searchParams.get("intent") ?? "";
  const bookingId = req.nextUrl.searchParams.get("booking") ?? "";
  if (!intentId || !bookingId) {
    return NextResponse.json({ error: "Missing the payment or booking reference." }, { status: 400 });
  }

  try {
    const state = await getIntentState(intentId);
    const booking = await getBooking(bookingId);
    if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });

    const already = (booking.pricing.payments ?? []).some((p) => p.intentId === intentId);
    if (state.status !== "succeeded") {
      return NextResponse.json({ status: state.status, recorded: already, error: state.lastError });
    }
    if (already) return NextResponse.json({ status: "succeeded", recorded: true });

    const payment: BookingPayment = {
      id: randomUUID(),
      method: "card",
      amountCents: state.amountCents,
      payer: (req.nextUrl.searchParams.get("payer") ?? "").trim().slice(0, 60) || null,
      note: "Card reader",
      at: new Date().toISOString(),
      intentId,
    };
    const pricing = {
      ...booking.pricing,
      paidCents: booking.pricing.paidCents + payment.amountCents,
      balanceCents: Math.max(0, booking.pricing.balanceCents - payment.amountCents),
      payments: [...(booking.pricing.payments ?? []), payment],
    };
    await updateBookingFields(bookingId, { pricing });
    await logActivity("Card payment taken", `${formatMoney(payment.amountCents)} on ${booking.reference} (reader)`);
    return NextResponse.json({ status: "succeeded", recorded: true, pricing });
  } catch (err) {
    console.error("terminal status check failed:", err);
    return NextResponse.json({ error: "Lost contact with the reader — check it and try again." }, { status: 502 });
  }
}
