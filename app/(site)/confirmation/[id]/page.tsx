import Link from "next/link";
import { notFound } from "next/navigation";
import ConfirmationEffects from "@/components/ConfirmationEffects";
import ProgressSteps from "@/components/ProgressSteps";
import RoomBadge from "@/components/RoomBadge";
import { finalizeBookingPayment, getBooking, logActivity } from "@/lib/db";
import { getBookingPolicies } from "@/lib/settings";
import { retrieveCheckoutSession, stripeConfigured } from "@/lib/stripe";
import { formatDateLong, formatMoney, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const UNIT_LABEL = { days: "day", weeks: "week", months: "month" } as const;

export default async function ConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sid?: string }>;
}) {
  const { id } = await params;
  let booking = await getBooking(id);
  if (!booking) notFound();

  // Stripe flow: the customer lands here straight from Stripe with the session
  // id. Verify payment server-side and finalize — the webhook does the same
  // (idempotently) for customers who never return.
  if (booking.status === "pending" && stripeConfigured()) {
    const { sid } = await searchParams;
    if (sid) {
      try {
        const session = await retrieveCheckoutSession(sid);
        if (session.payment_status === "paid" && session.metadata?.bookingId === booking.id) {
          const finalized = await finalizeBookingPayment(booking.id, session.amount_total ?? 0);
          if (finalized) {
            booking = finalized;
            await logActivity("Payment received", `${booking.reference} — paid via Stripe`);
          }
        }
      } catch (err) {
        console.error("verifying checkout session failed:", err);
      }
    }
  }

  if (booking.status === "pending") {
    return (
      <>
        <ProgressSteps current={3} />
        <div className="empty-state">
          <h1 className="page-title">Payment not completed</h1>
          <p>
            Your booking <strong>{booking.reference}</strong> is reserved but hasn&apos;t been paid, so it isn&apos;t
            confirmed yet. Your card has not been charged. The held spots are released automatically if payment
            isn&apos;t completed soon.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link href="/checkout/payment" className="btn">
              Return to payment
            </Link>
          </p>
        </div>
      </>
    );
  }

  const { customer, items, pricing } = booking;
  const policies = await getBookingPolicies();
  const shownPolicies = [
    { key: "reschedule", verb: "reschedule", ...policies.reschedule },
    { key: "cancellation", verb: "cancel", ...policies.cancellation },
  ].filter((p) => p.show && (p.content.trim() || p.title.trim()));

  return (
    <>
      <ConfirmationEffects reference={booking.reference} totalCents={pricing.totalCents} />
      <ProgressSteps current={4} />

      <div className="confirm-hero">
        <h1>Booking complete — see you soon, {customer.firstName}!</h1>
        <p className="reference">
          Your booking reference is <strong>{booking.reference}</strong>
        </p>
        <p className="confirm-note">
          A confirmation email would be sent to {customer.email} in a production setup. Please arrive 15 minutes
          before your start time.
        </p>
      </div>

      <div className="confirm-grid">
        <div className="form-card">
          <h3>Your bookings</h3>
          {items.map((item, i) => {
            return (
              <div className="summary-item" key={i}>
                <RoomBadge name={item.roomName} bg={item.badgeBg ?? "#0B2540"} fg={item.badgeFg ?? "#fff"} />
                <div className="summary-item-info">
                  <div className="name">
                    {item.roomName} — {item.location}
                  </div>
                  <div className="meta">
                    {formatDateLong(item.date)} — {formatTime(item.time)} ({item.durationMinutes} minutes)
                  </div>
                  <div className="meta">
                    {item.quantity} × {formatMoney(item.priceCents)} = {formatMoney(item.quantity * item.priceCents)}
                  </div>
                </div>
              </div>
            );
          })}
          {shownPolicies.length > 0 && (
            <div className="confirm-policies">
              {shownPolicies.map((p) => (
                <div className="confirm-policy" key={p.key}>
                  <h4>{p.title}</h4>
                  <p className="policy-cutoff">
                    You can {p.verb} up to {p.cutoffValue} {UNIT_LABEL[p.cutoffUnit]}
                    {p.cutoffValue === 1 ? "" : "s"} before your session.
                  </p>
                  {p.content.trim() && <p className="policy-body">{p.content}</p>}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <Link href="/" className="btn">
              Make another booking
            </Link>
          </div>
        </div>

        <aside className="summary">
          <div className="summary-body">
            <h3 className="summary-heading">Payment summary</h3>
            <div className="summary-totals" style={{ borderTop: "none", paddingTop: 0 }}>
              <div className="summary-line">
                <span>Subtotal</span>
                <span>{formatMoney(pricing.subtotalCents)}</span>
              </div>
              {pricing.discountCents > 0 && (
                <div className="summary-line discount">
                  <span>Promo ({booking.promoCode})</span>
                  <span>-{formatMoney(pricing.discountCents)}</span>
                </div>
              )}
              <div className="summary-line">
                <span>Tax</span>
                <span>{formatMoney(pricing.gstCents)}</span>
              </div>
              <div className="summary-line total">
                <span>Total</span>
                <span>{formatMoney(pricing.totalCents)}</span>
              </div>
              <div className="summary-line">
                <span>Paid now {booking.paymentOption === "deposit" ? "(deposit)" : ""}</span>
                <span>{formatMoney(pricing.paidCents)}</span>
              </div>
              {pricing.balanceCents > 0 && (
                <div className="summary-line due">
                  <span>Balance due at venue</span>
                  <span>{formatMoney(pricing.balanceCents)}</span>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
