// Refunding part or all of a booking without cancelling it — the group that
// was overcharged, the two guests who didn't turn up, the goodwill gesture.
//
// Refunds are made against a SPECIFIC payment, never against the booking as a
// whole: a party often pays on several cards, and the money has to go back to
// the card it came from. That also means the amount available to refund is
// capped per payment, not per booking.
//
// Money is modelled the way cancellation already does it: `paidCents` records
// what was collected and is left alone, while refundOwedCents/refundedCents
// carry the refund side. So a refunded booking never starts showing a balance
// due again, which would invite staff to collect it a second time.
import { addBookingNote, logActivity, updateBookingFields } from "./db";
import { formatMoney } from "./format";
import { PAYMENT_METHOD_LABEL } from "./payment-methods";
import { refundPayment, stripeConfigured } from "./stripe";
import type { Booking, BookingPayment } from "./types";

export type RefundOutcome =
  | { error: string }
  | {
      refundedCents: number;
      toCard: boolean; // true = Stripe sent it back; false = settle by hand
      pricing: Booking["pricing"];
    };

// What is still refundable on one payment.
export function refundableCents(payment: BookingPayment): number {
  return Math.max(0, payment.amountCents - (payment.refundedCents ?? 0));
}

// The money taken at checkout, which is the one payment this app can always
// send back to the card: Stripe took it and left a payment intent behind. It
// isn't in `payments` — that list is manual records — so it is worked out the
// same way the booking page does, and its refunds are tracked on the booking.
export const ONLINE_PAYMENT_ID = "online";

export function onlinePayment(booking: Booking): {
  amountCents: number;
  refundedCents: number;
  refundableCents: number;
  intentId: string | null;
} | null {
  const p = booking.pricing;
  const voucher = p.voucherRedeemed ? (p.voucherCents ?? 0) : 0;
  const manual = (p.payments ?? []).reduce((sum, x) => sum + x.amountCents, 0);
  const amountCents = p.paidCents - voucher - manual;
  if (amountCents <= 0) return null;
  const refundedCents = p.onlineRefundedCents ?? 0;
  return {
    amountCents,
    refundedCents,
    refundableCents: Math.max(0, amountCents - refundedCents),
    intentId: p.stripePaymentIntent ?? null,
  };
}

export async function refundBookingPayment(
  booking: Booking,
  paymentId: string,
  amountCents: number,
  staffName: string
): Promise<RefundOutcome> {
  const payments = booking.pricing.payments ?? [];
  const online = paymentId === ONLINE_PAYMENT_ID ? onlinePayment(booking) : null;
  const payment = online ? null : payments.find((p) => p.id === paymentId);
  if (!online && !payment) return { error: "That payment is no longer on this booking." };

  const available = online ? online.refundableCents : refundableCents(payment as BookingPayment);
  if (available <= 0) return { error: "That payment has already been refunded in full." };
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { error: "Enter how much to refund." };
  }
  if (amountCents > available) {
    return { error: `That payment only has ${formatMoney(available)} left to refund.` };
  }

  // Back to the card where Stripe took it; otherwise the money was taken
  // somewhere this app can't reach (a standalone terminal, the old system) and
  // staff refund it there — recording it here keeps the booking honest.
  let toCard = false;
  const intentId = online ? online.intentId : (payment as BookingPayment).intentId;
  if (intentId && stripeConfigured()) {
    try {
      const sent = await refundPayment(intentId, amountCents);
      if (sent === null) return { error: "Stripe is not configured, so the card can't be refunded from here." };
      toCard = true;
    } catch (err) {
      console.error("stripe refund failed:", err);
      return {
        error:
          err instanceof Error && err.message
            ? `Stripe refused the refund: ${err.message}`
            : "Stripe refused the refund. Check the payment in Stripe and try again.",
      };
    }
  }

  const nextPayments = payments.map((p) =>
    p.id === paymentId ? { ...p, refundedCents: (p.refundedCents ?? 0) + amountCents } : p
  );
  // Owed is what the customer is due back; refunded is what has actually
  // reached them. A refund staff have to settle on the terminal counts towards
  // the first and not the second, or the booking would claim the money had gone
  // back when it is still sitting in the till.
  const owedTotal = (booking.pricing.refundOwedCents ?? 0) + amountCents;
  const refundedTotal = (booking.pricing.refundedCents ?? 0) + (toCard ? amountCents : 0);
  const pricing: Booking["pricing"] = {
    ...booking.pricing,
    payments: nextPayments,
    ...(online ? { onlineRefundedCents: online.refundedCents + amountCents } : {}),
    refundedCents: refundedTotal,
    refundOwedCents: owedTotal,
    refundedAt: new Date().toISOString(),
  };

  await updateBookingFields(booking.id, { pricing });
  const how = toCard ? "to the card via Stripe" : "to be settled by hand";
  await logActivity("Refund issued", `${formatMoney(amountCents)} on ${booking.reference} — ${how}`);
  const against = online
    ? `the ${formatMoney(online.amountCents)} taken at checkout`
    : `the ${formatMoney((payment as BookingPayment).amountCents)} ` +
      `${PAYMENT_METHOD_LABEL[(payment as BookingPayment).method]} payment` +
      ((payment as BookingPayment).payer ? ` from ${(payment as BookingPayment).payer}` : "");
  await addBookingNote(booking.id, `Refund of ${formatMoney(amountCents)} against ${against} — ${how}.`, staffName);
  return { refundedCents: amountCents, toCard, pricing };
}
