import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { getBooking, logActivity, takeVoucherFor, updateBookingFields } from "@/lib/db";
import { formatMoney, todayISO } from "@/lib/format";
import { getVoucher, refundToVoucher, searchSpendableVouchers, voucherProblem } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

// Type-ahead for the voucher code box: ?q=WB lists spendable codes containing
// "WB", with what's left on each. Same permission as applying one, so the desk
// doesn't need Promo codes access just to look a card up.
export async function GET(req: NextRequest) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 2) return NextResponse.json({ vouchers: [] });
  try {
    const found = await searchSpendableVouchers(q);
    return NextResponse.json({
      vouchers: found.map((v) => ({
        code: v.code,
        faceCents: v.faceCents,
        remainingCents: v.remainingCents,
        purchaser: v.purchaser,
      })),
    });
  } catch (err) {
    console.error("voucher search failed:", err);
    return NextResponse.json({ error: "Could not search vouchers right now." }, { status: 500 });
  }
}

// Put a customer's gift voucher towards an existing booking, at the desk. A
// voucher is money, not a discount: the balance comes off the voucher first
// (same compare-and-swap as checkout and walk-ins) and is then recorded in the
// same pricing fields, so the Payments tab, receipts and a later cancellation
// all already know what to do with it. One voucher per booking, as at checkout.
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
  const o = (body ?? {}) as Record<string, unknown>;
  const code = String(o.code ?? "").trim().toUpperCase();
  if (!code || code.length > 40) {
    return NextResponse.json({ error: "Enter the gift voucher code." }, { status: 400 });
  }
  // Optional: how much of the voucher to use. Left out = as much as the balance needs.
  const asked = o.amountCents === undefined || o.amountCents === null || o.amountCents === "" ? null : Number(o.amountCents);
  if (asked !== null && (!Number.isInteger(asked) || asked <= 0)) {
    return NextResponse.json({ error: "Enter an amount greater than zero, or leave it blank to use the balance due." }, { status: 400 });
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
    if (booking.pricing.voucherCode) {
      return NextResponse.json(
        { error: `Gift voucher ${booking.pricing.voucherCode} is already on this booking. Remove it first to use another.` },
        { status: 409 }
      );
    }
    const balance = booking.pricing.balanceCents;
    if (balance <= 0) {
      return NextResponse.json({ error: "This booking has no balance due." }, { status: 400 });
    }
    if (asked !== null && asked > balance) {
      return NextResponse.json({ error: `That's more than the ${formatMoney(balance)} due — enter a smaller amount.` }, { status: 400 });
    }

    // Say exactly what's wrong before any money moves: takeVoucherFor only logs.
    const voucher = await getVoucher(code);
    if (!voucher) return NextResponse.json({ error: "No gift voucher with that code." }, { status: 404 });
    if (voucher.redemptionType === "spaces") {
      return NextResponse.json(
        { error: "That voucher is for spaces, not a dollar balance — redeem it from its page under Promo codes." },
        { status: 400 }
      );
    }
    const today = todayISO();
    for (const item of booking.items) {
      const problem = voucherProblem(voucher, { today, date: item.date, time: item.time, roomId: item.roomId });
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    const want = Math.min(asked ?? balance, voucher.remainingCents);
    const taken = await takeVoucherFor({
      ...booking,
      pricing: { ...booking.pricing, voucherCode: voucher.code, voucherCents: want, voucherRedeemed: false },
    });
    if (taken <= 0) {
      return NextResponse.json(
        { error: "That gift voucher could not be applied — its balance may have just been spent. Check it under Promo codes." },
        { status: 409 }
      );
    }

    const pricing = {
      ...booking.pricing,
      paidCents: booking.pricing.paidCents + taken,
      balanceCents: balance - taken,
      voucherCode: voucher.code,
      voucherCents: taken,
      voucherRedeemed: true,
    };
    await updateBookingFields(id, { pricing });
    await logActivity("Gift voucher applied", `${voucher.code} — ${formatMoney(taken)} towards ${booking.reference}`);
    return NextResponse.json({ ok: true, pricing, takenCents: taken });
  } catch (err) {
    console.error("applying gift voucher failed:", err);
    return NextResponse.json({ error: "Could not apply the voucher right now. Please try again." }, { status: 500 });
  }
}

// Undo a voucher put on by mistake: the money goes back on the voucher and
// the booking owes it again.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;
  try {
    const booking = await getBooking(id);
    if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
    if (!booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
      return NextResponse.json({ error: "That booking is at a location your account doesn't cover." }, { status: 403 });
    }
    const { voucherCode, voucherCents = 0, voucherRedeemed } = booking.pricing;
    if (!voucherCode) {
      return NextResponse.json({ error: "This booking has no gift voucher on it." }, { status: 400 });
    }
    if (booking.status === "cancelled") {
      return NextResponse.json({ error: "This booking is cancelled — its voucher balance was already returned." }, { status: 400 });
    }

    // Money that was actually taken goes back first; if the voucher can't take
    // it (deleted, or already back at face value) the booking must not be
    // changed, or the customer loses that balance.
    if (voucherRedeemed && voucherCents > 0) {
      const back = await refundToVoucher(voucherCode, voucherCents);
      if (!back) {
        return NextResponse.json(
          { error: `Could not put ${formatMoney(voucherCents)} back on ${voucherCode}. Check the voucher under Promo codes, then try again.` },
          { status: 409 }
        );
      }
    }
    const returned = voucherRedeemed ? voucherCents : 0;
    const pricing = {
      ...booking.pricing,
      paidCents: booking.pricing.paidCents - returned,
      balanceCents: booking.pricing.balanceCents + returned,
      voucherCode: null,
      voucherCents: 0,
      voucherRedeemed: false,
    };
    await updateBookingFields(id, { pricing });
    await logActivity("Gift voucher removed", `${voucherCode} — ${formatMoney(returned)} back on the voucher, from ${booking.reference}`);
    return NextResponse.json({ ok: true, pricing });
  } catch (err) {
    console.error("removing gift voucher failed:", err);
    return NextResponse.json({ error: "Could not remove the voucher right now. Please try again." }, { status: 500 });
  }
}
