import { randomUUID } from "crypto";
import { apiGuard } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { getBooking, logActivity, updateBookingFields } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import type { BookingPayment } from "@/lib/types";

export const dynamic = "force-dynamic";

const METHODS: BookingPayment["method"][] = ["cash", "card", "etransfer", "other"];
const METHOD_LABEL: Record<BookingPayment["method"], string> = {
  cash: "Cash",
  card: "Card (terminal)",
  etransfer: "E-transfer",
  other: "Other",
};

// Record a payment taken outside the app (cash, card terminal, e-transfer).
// This is bookkeeping only — no card is charged here.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const d = body as { method?: unknown; amountCents?: unknown; note?: unknown };
  const method = METHODS.includes(d.method as BookingPayment["method"])
    ? (d.method as BookingPayment["method"])
    : null;
  const amountCents = Number.isInteger(d.amountCents) ? (d.amountCents as number) : NaN;
  const note = typeof d.note === "string" ? d.note.trim().slice(0, 200) : "";

  if (!method) return NextResponse.json({ error: "Choose how the payment was taken." }, { status: 400 });
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "Enter a payment amount greater than zero." }, { status: 400 });
  }

  try {
    const booking = await getBooking(id);
    if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
    if (booking.pricing.balanceCents <= 0) {
      return NextResponse.json({ error: "This booking has no balance due." }, { status: 400 });
    }
    if (amountCents > booking.pricing.balanceCents) {
      return NextResponse.json(
        { error: `That's more than the ${formatMoney(booking.pricing.balanceCents)} due. Enter the amount actually owing.` },
        { status: 400 }
      );
    }

    const payment: BookingPayment = {
      id: randomUUID(),
      method,
      amountCents,
      note: note || null,
      at: new Date().toISOString(),
    };
    const pricing = {
      ...booking.pricing,
      paidCents: booking.pricing.paidCents + amountCents,
      balanceCents: booking.pricing.balanceCents - amountCents,
      payments: [...(booking.pricing.payments ?? []), payment],
    };
    await updateBookingFields(id, { pricing });
    await logActivity(
      "Recorded payment",
      `${formatMoney(amountCents)} ${METHOD_LABEL[method]} on ${booking.reference}`
    );
    return NextResponse.json({ ok: true, pricing });
  } catch (err) {
    console.error("recording payment failed:", err);
    return NextResponse.json({ error: "Could not record the payment right now. Please try again." }, { status: 500 });
  }
}

// Delete a mistaken manual payment record and restore the balance.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;
  const pid = req.nextUrl.searchParams.get("pid") ?? "";
  if (!pid) return NextResponse.json({ error: "Missing payment id." }, { status: 400 });

  try {
    const booking = await getBooking(id);
    if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
    const payments = booking.pricing.payments ?? [];
    const payment = payments.find((p) => p.id === pid);
    if (!payment) return NextResponse.json({ error: "That payment record no longer exists." }, { status: 404 });

    const pricing = {
      ...booking.pricing,
      paidCents: booking.pricing.paidCents - payment.amountCents,
      balanceCents: booking.pricing.balanceCents + payment.amountCents,
      payments: payments.filter((p) => p.id !== pid),
    };
    await updateBookingFields(id, { pricing });
    await logActivity(
      "Removed payment record",
      `${formatMoney(payment.amountCents)} ${METHOD_LABEL[payment.method]} on ${booking.reference}`
    );
    return NextResponse.json({ ok: true, pricing });
  } catch (err) {
    console.error("removing payment failed:", err);
    return NextResponse.json({ error: "Could not remove the payment right now. Please try again." }, { status: 500 });
  }
}
