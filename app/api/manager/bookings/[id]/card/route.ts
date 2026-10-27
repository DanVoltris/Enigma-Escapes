import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { chargeTypedCard } from "@/lib/card-entry";
import { getBooking } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { getLocale } from "@/lib/locale";
import { cardEntryKey } from "@/lib/stripe";
import { recordReaderPayment } from "@/lib/stripe-terminal";

export const dynamic = "force-dynamic";

// Charge a card typed in at the desk (a customer paying over the phone) and
// record it on the booking. The browser sends only the PaymentMethod id that
// Stripe.js made from the card box — never a card number (lib/card-entry.ts).
// Money moves here, so everything about the booking is re-checked first.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;
  if (!cardEntryKey()) {
    return NextResponse.json({ error: "Card payments aren't set up for this venue." }, { status: 400 });
  }

  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const paymentMethodId = typeof o.paymentMethodId === "string" ? o.paymentMethodId : "";
  const idempotencyKey = typeof o.idempotencyKey === "string" ? o.idempotencyKey : "";
  const amountCents = Number.isInteger(o.amountCents) ? (o.amountCents as number) : NaN;
  if (!/^pm_[A-Za-z0-9_]+$/.test(paymentMethodId)) {
    return NextResponse.json({ error: "The card details didn't come through. Enter them again." }, { status: 400 });
  }
  if (!/^[A-Za-z0-9-]{16,64}$/.test(idempotencyKey)) {
    return NextResponse.json({ error: "Reload the page and try again." }, { status: 400 });
  }
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
  }

  try {
    const booking = await getBooking(id);
    if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
    if (!booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
      return NextResponse.json({ error: "That booking is at a location your account doesn't cover." }, { status: 403 });
    }
    if (booking.status === "cancelled") {
      return NextResponse.json({ error: "This booking is cancelled — nothing is owed on it." }, { status: 400 });
    }
    if (amountCents > booking.pricing.balanceCents) {
      return NextResponse.json(
        { error: `That's more than the ${formatMoney(booking.pricing.balanceCents)} still due.` },
        { status: 400 }
      );
    }

    const { currencyCode } = await getLocale();
    const staffName = guard.staff.name || guard.staff.email;
    const result = await chargeTypedCard(
      paymentMethodId,
      amountCents,
      currencyCode,
      { bookingId: booking.id, reference: booking.reference, staff: staffName },
      idempotencyKey
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error, final: result.final }, { status: 402 });
    }

    const note = `Card typed in${result.card ? ` · ${result.card}` : ""} · by ${staffName}`;
    const recorded = await recordReaderPayment(booking.id, result.intentId, result.amountCents, "", {
      note: note.slice(0, 120),
      how: `card typed in by ${staffName}`,
    });
    return NextResponse.json({ ok: true, card: result.card, pricing: recorded?.pricing ?? null });
  } catch (err) {
    console.error("typed card charge failed:", err);
    return NextResponse.json(
      { error: "Something went wrong after the card was sent. Check Stripe before trying again.", final: false },
      { status: 500 }
    );
  }
}
