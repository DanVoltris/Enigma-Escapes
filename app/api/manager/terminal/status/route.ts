import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { getBooking } from "@/lib/db";
import { getIntentState, recordReaderPayment, terminalConfigured } from "@/lib/stripe-terminal";

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
    if (state.status !== "succeeded") {
      const booking = await getBooking(bookingId);
      if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
      const already = (booking.pricing.payments ?? []).some((p) => p.intentId === intentId);
      return NextResponse.json({ status: state.status, recorded: already, error: state.lastError });
    }

    const recorded = await recordReaderPayment(
      bookingId,
      intentId,
      state.amountCents,
      req.nextUrl.searchParams.get("payer") ?? ""
    );
    if (!recorded) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
    if (!recorded.pricing) return NextResponse.json({ status: "succeeded", recorded: true });
    return NextResponse.json({ status: "succeeded", recorded: true, pricing: recorded.pricing });
  } catch (err) {
    console.error("terminal status check failed:", err);
    return NextResponse.json({ error: "Lost contact with the reader — check it and try again." }, { status: 502 });
  }
}
