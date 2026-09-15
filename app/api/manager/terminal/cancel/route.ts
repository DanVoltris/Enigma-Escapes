import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import {
  cancelIntent,
  cancelReaderAction,
  getIntentState,
  recordReaderPayment,
  terminalConfigured,
} from "@/lib/stripe-terminal";

export const dynamic = "force-dynamic";

// Staff backed out: clear the reader's screen and void the pending payment.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  if (!terminalConfigured()) return NextResponse.json({ ok: true });

  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const readerId = typeof o.readerId === "string" ? o.readerId : "";
  const intentId = typeof o.intentId === "string" ? o.intentId : "";
  const bookingId = typeof o.bookingId === "string" ? o.bookingId : "";
  const payer = typeof o.payer === "string" ? o.payer : "";
  if (readerId) await cancelReaderAction(readerId);
  if (intentId) await cancelIntent(intentId);

  // A payment can't be cancelled once it has gone through, and both calls
  // above stay quiet about that. The customer may have tapped as staff pressed
  // Cancel, or after the Today screen stopped waiting: look, and if the money
  // was taken, record it now rather than leave the balance showing as due.
  if (intentId && bookingId) {
    try {
      const state = await getIntentState(intentId);
      if (state.status === "succeeded") {
        const recorded = await recordReaderPayment(bookingId, intentId, state.amountCents, payer);
        if (recorded) return NextResponse.json({ ok: true, paid: true, amountCents: state.amountCents });
      }
      if (state.status === "processing") {
        return NextResponse.json(
          { error: "The card is being processed right now — wait a moment, then press Cancel again." },
          { status: 409 }
        );
      }
    } catch (err) {
      console.error("checking the reader payment after cancel failed:", err);
      return NextResponse.json(
        {
          error:
            "Couldn't confirm with Stripe whether the card went through. Check the payment in Stripe before charging again.",
        },
        { status: 502 }
      );
    }
  }
  return NextResponse.json({ ok: true });
}
