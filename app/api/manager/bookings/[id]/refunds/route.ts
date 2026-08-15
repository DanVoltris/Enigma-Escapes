import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { getBooking } from "@/lib/db";
import { PAYMENT_METHOD_LABEL } from "@/lib/payment-methods";
import { refundableCents, refundBookingPayment } from "@/lib/refunds";
import { cardForPayment, stripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// The payments on a booking and what is still refundable on each, with the card
// behind it named where Stripe can say — a party often pays on several cards,
// and "$60.00 card" twice over tells a staff member nothing about which is
// which. Looked up on demand rather than at page load, so a booking with no
// refund to make never pays for the call.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await params;

  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
  if (!booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
    return NextResponse.json({ error: "That booking is at a location your account doesn't cover." }, { status: 403 });
  }

  const payments = booking.pricing.payments ?? [];
  const rows = await Promise.all(
    payments.map(async (p) => ({
      id: p.id,
      method: p.method,
      methodLabel: PAYMENT_METHOD_LABEL[p.method],
      amountCents: p.amountCents,
      refundedCents: p.refundedCents ?? 0,
      refundableCents: refundableCents(p),
      payer: p.payer ?? null,
      at: p.at,
      toCard: Boolean(p.intentId) && stripeConfigured(),
      card: p.intentId ? await cardForPayment(p.intentId) : null,
    }))
  );
  return NextResponse.json({
    reference: booking.reference,
    totalCents: booking.pricing.totalCents,
    paidCents: booking.pricing.paidCents,
    refundedCents: booking.pricing.refundedCents ?? 0,
    refundOwedCents: Math.max(
      0,
      (booking.pricing.refundOwedCents ?? 0) - (booking.pricing.refundedCents ?? 0)
    ),
    payments: rows,
  });
}

// Refund part or all of one payment. Always against a specific payment so the
// money goes back to the card that was charged.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const paymentId = typeof raw.paymentId === "string" ? raw.paymentId : "";
  const amountCents = Number.isInteger(raw.amountCents) ? (raw.amountCents as number) : NaN;
  if (!paymentId) return NextResponse.json({ error: "Which payment is being refunded?" }, { status: 400 });
  if (!Number.isFinite(amountCents)) {
    return NextResponse.json({ error: "Enter how much to refund." }, { status: 400 });
  }

  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
  if (!booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
    return NextResponse.json({ error: "That booking is at a location your account doesn't cover." }, { status: 403 });
  }

  const result = await refundBookingPayment(booking, paymentId, amountCents, guard.staff.name);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, refundedCents: result.refundedCents, toCard: result.toCard });
}
