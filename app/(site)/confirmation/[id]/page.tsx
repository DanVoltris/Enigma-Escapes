import Link from "next/link";
import { notFound } from "next/navigation";
import ProgressSteps from "@/components/ProgressSteps";
import RoomBadge from "@/components/RoomBadge";
import { getBooking } from "@/lib/db";
import { formatDateLong, formatMoney, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await getBooking(id);
  if (!booking) notFound();

  const { customer, items, pricing } = booking;

  return (
    <>
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
