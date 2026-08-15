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

export async function refundBookingPayment(
  booking: Booking,
  paymentId: string,
  amountCents: number,
  staffName: string
): Promise<RefundOutcome> {
  const payments = booking.pricing.payments ?? [];
  const payment = payments.find((p) => p.id === paymentId);
  if (!payment) return { error: "That payment is no longer on this booking." };

  const available = refundableCents(payment);
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
  if (payment.intentId && stripeConfigured()) {
    try {
      const sent = await refundPayment(payment.intentId, amountCents);
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
  const refundedTotal = (booking.pricing.refundedCents ?? 0) + amountCents;
  const pricing: Booking["pricing"] = {
    ...booking.pricing,
    payments: nextPayments,
    refundedCents: refundedTotal,
    // Never let "owed" sit below what has actually gone back, or the two
    // figures tell contradictory stories on the bookings list.
    refundOwedCents: Math.max(booking.pricing.refundOwedCents ?? 0, refundedTotal),
    refundedAt: new Date().toISOString(),
  };

  await updateBookingFields(booking.id, { pricing });
  const how = toCard ? "to the card via Stripe" : "to be settled by hand";
  await logActivity("Refund issued", `${formatMoney(amountCents)} on ${booking.reference} — ${how}`);
  await addBookingNote(
    booking.id,
    `Refund of ${formatMoney(amountCents)} against the ${formatMoney(payment.amountCents)} ` +
      `${PAYMENT_METHOD_LABEL[payment.method]} payment${payment.payer ? ` from ${payment.payer}` : ""} — ${how}.`,
    staffName
  );
  return { refundedCents: amountCents, toCard, pricing };
}
