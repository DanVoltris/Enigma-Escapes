import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { getBooking } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { getLocale } from "@/lib/locale";
import { createCardPresentIntent, pushToReader, terminalConfigured } from "@/lib/stripe-terminal";
import { readerForLocation } from "@/lib/terminal-settings";

export const dynamic = "force-dynamic";

// Puts an amount on the card reader at the booking's venue. Returns the
// payment id the Today screen then polls. No money moves here — the customer
// tapping the reader is what completes it.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  if (!terminalConfigured()) {
    return NextResponse.json(
      { error: "Card terminal isn't set up yet — add your Stripe keys, then pair a reader in Settings → Payments." },
      { status: 400 }
    );
  }

  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const bookingId = typeof o.bookingId === "string" ? o.bookingId : "";
  const amountCents = Number.isInteger(o.amountCents) ? (o.amountCents as number) : NaN;
  const payer = typeof o.payer === "string" ? o.payer.trim().slice(0, 60) : "";
  if (!bookingId) return NextResponse.json({ error: "Which booking is this for?" }, { status: 400 });
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
  }

  const booking = await getBooking(bookingId);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
  const location = booking.items[0]?.location ?? "";
  if (!canSeeLocation(guard.staff, location)) {
    return NextResponse.json({ error: "That booking is at another location." }, { status: 403 });
  }
  if (amountCents > booking.pricing.balanceCents) {
    return NextResponse.json(
      { error: `That's more than the ${formatMoney(booking.pricing.balanceCents)} still due.` },
      { status: 400 }
    );
  }

  const readerId = await readerForLocation(location);
  if (!readerId) {
    return NextResponse.json(
      { error: `No card reader is paired with ${location} yet — pair one in Settings → Payments.` },
      { status: 400 }
    );
  }

  try {
    const { currencyCode } = await getLocale();
    const intentId = await createCardPresentIntent(amountCents, currencyCode, {
      bookingId,
      reference: booking.reference,
      payer,
    });
    await pushToReader(readerId, intentId);
    return NextResponse.json({ ok: true, intentId, readerId });
  } catch (err) {
    console.error("terminal charge failed:", err);
    const msg = err instanceof Error ? err.message : "Could not reach the card reader.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
