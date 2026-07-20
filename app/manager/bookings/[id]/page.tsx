import Link from "next/link";
import { notFound } from "next/navigation";
import RoomBadge from "@/components/RoomBadge";
import NoShowToggle from "@/components/manager/NoShowToggle";
import { getBooking } from "@/lib/db";
import { formatDateLong, formatMoney, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ManagerBookingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await getBooking(id);
  if (!booking) notFound();

  const { customer, items, pricing } = booking;
  const created = new Date(booking.createdAt);

  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/bookings">← Back to all bookings</Link>
      </p>
      <h1 className="mgr-page-title">Booking {booking.reference}</h1>
      <p className="mgr-page-sub">
        Placed {created.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
        {booking.source === "in_person" ? "In-person / walk-in" : "Booked online"} ·{" "}
        {booking.paymentOption === "deposit" ? "Deposit paid" : "Paid in full"}
        {booking.promoCode ? ` · Promo ${booking.promoCode}` : ""}
      </p>

      <div className="mgr-card">
        <h2>Attendance</h2>
        <p className="card-sub">Mark this booking as a no-show if the party doesn&apos;t turn up. No-shows feed the dashboard.</p>
        <NoShowToggle id={booking.id} initial={booking.noShow} />
      </div>

      <div className="mgr-stats">
        <div className="mgr-stat">
          <div className="label">Total</div>
          <div className="value">{formatMoney(pricing.totalCents)}</div>
          <div className="hint">including GST</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Paid</div>
          <div className="value">{formatMoney(pricing.paidCents)}</div>
          <div className="hint">collected at booking</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Balance due</div>
          <div className="value">{formatMoney(pricing.balanceCents)}</div>
          <div className="hint">{pricing.balanceCents > 0 ? "collect at the venue" : "nothing owing"}</div>
        </div>
      </div>

      <div className="mgr-card">
        <h2>Customer</h2>
        <p>
          {customer.firstName} {customer.lastName}
          <br />
          <a href={`mailto:${customer.email}`}>{customer.email}</a>
          <br />
          <a href={`tel:${customer.phone}`}>{customer.phone}</a>
          <br />
          <span style={{ color: "var(--text-secondary)" }}>
            {customer.subscribe ? "Subscribed to marketing emails" : "Not subscribed to marketing emails"}
          </span>
        </p>
      </div>

      <div className="mgr-card">
        <h2>Sessions</h2>
        <div className="mgr-table-wrap">
          <table className="mgr-table">
            <thead>
              <tr>
                <th>Experience</th>
                <th>Date</th>
                <th>Time</th>
                <th className="num">Guests</th>
                <th className="num">Price each</th>
                <th className="num">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <RoomBadge name={item.roomName} bg={item.badgeBg ?? "#0B2540"} fg={item.badgeFg ?? "#fff"} />
                      {item.roomName} — {item.location}
                    </span>
                  </td>
                  <td>{formatDateLong(item.date)}</td>
                  <td>{formatTime(item.time)}</td>
                  <td className="num">{item.quantity}</td>
                  <td className="num">{formatMoney(item.priceCents)}</td>
                  <td className="num">{formatMoney(item.priceCents * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mgr-card">
        <h2>Payment breakdown</h2>
        <div className="summary-totals" style={{ borderTop: "none", paddingTop: 0, maxWidth: 360 }}>
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
            <span>GST (5%)</span>
            <span>{formatMoney(pricing.gstCents)}</span>
          </div>
          <div className="summary-line total">
            <span>Total</span>
            <span>{formatMoney(pricing.totalCents)}</span>
          </div>
          <div className="summary-line">
            <span>Paid {booking.paymentOption === "deposit" ? "(deposit)" : ""}</span>
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
    </>
  );
}
