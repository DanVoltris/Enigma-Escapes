import { randomUUID } from "crypto";
import { apiGuard } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { getBooking, logActivity, updateBookingFields } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { isPaymentMethod, PAYMENT_METHOD_LABEL } from "@/lib/payment-methods";
import type { BookingPayment } from "@/lib/types";

export const dynamic = "force-dynamic";

const METHOD_LABEL = PAYMENT_METHOD_LABEL;

// Records money taken at the desk. Accepts a single payment or a list, so a
// party can split the bill across people and across methods in one action.
// Bookkeeping only — no card is charged here.
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
  const d = (body ?? {}) as Record<string, unknown>;
  const rawList = Array.isArray(d.payments) ? d.payments : [d];
  if (rawList.length === 0) return NextResponse.json({ error: "Add at least one payment." }, { status: 400 });
  if (rawList.length > 20) {
    return NextResponse.json({ error: "That's a lot of splits — 20 at most." }, { status: 400 });
  }

  const lines: { method: BookingPayment["method"]; amountCents: number; note: string; payer: string }[] = [];
  for (const raw of rawList) {
    const o = (raw ?? {}) as Record<string, unknown>;
    if (!isPaymentMethod(o.method)) {
      return NextResponse.json({ error: "Choose how each payment was taken." }, { status: 400 });
    }
    const cents = Number.isInteger(o.amountCents) ? (o.amountCents as number) : NaN;
    if (!Number.isFinite(cents) || cents <= 0) {
      return NextResponse.json({ error: "Every payment needs an amount greater than zero." }, { status: 400 });
    }
    lines.push({
      method: o.method,
      amountCents: cents,
      note: typeof o.note === "string" ? o.note.trim().slice(0, 200) : "",
      payer: typeof o.payer === "string" ? o.payer.trim().slice(0, 60) : "",
    });
  }
  const amountCents = lines.reduce((sum, l) => sum + l.amountCents, 0);

  try {
    const booking = await getBooking(id);
    if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
    if (booking.pricing.balanceCents <= 0) {
      return NextResponse.json({ error: "This booking has no balance due." }, { status: 400 });
    }
    if (amountCents > booking.pricing.balanceCents) {
      return NextResponse.json(
        { error: `That totals more than the ${formatMoney(booking.pricing.balanceCents)} due — adjust the amounts.` },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const newPayments: BookingPayment[] = lines.map((l) => ({
      id: randomUUID(),
      method: l.method,
      amountCents: l.amountCents,
      payer: l.payer || null,
      note: l.note || null,
      at: now,
    }));
    const pricing = {
      ...booking.pricing,
      paidCents: booking.pricing.paidCents + amountCents,
      balanceCents: booking.pricing.balanceCents - amountCents,
      payments: [...(booking.pricing.payments ?? []), ...newPayments],
    };
    await updateBookingFields(id, { pricing });
    await logActivity(
      "Recorded payment",
      lines.length === 1
        ? `${formatMoney(amountCents)} ${METHOD_LABEL[lines[0].method]} on ${booking.reference}`
        : `${formatMoney(amountCents)} on ${booking.reference}, split ${lines.length} ways`
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
