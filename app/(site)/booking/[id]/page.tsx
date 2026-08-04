import Link from "next/link";
import { notFound } from "next/navigation";
import ManageBooking from "@/components/ManageBooking";
import { getBooking } from "@/lib/db";
import { getExperience } from "@/lib/experiences";
import { formatDateLong, formatMoney, formatTime, todayISO } from "@/lib/format";
import { minutesUntilFirstSession, selfServiceBlock } from "@/lib/manage-booking";
import { getBusinessDetails } from "@/lib/settings";

export const dynamic = "force-dynamic";

// The "manage your booking" link from the confirmation text.
export default async function ManageBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await getBooking(id);
  if (!booking) notFound();

  const block = selfServiceBlock(booking);
  const business = await getBusinessDetails().then((r) => r.value).catch(() => null);
  const phone = business?.phone ?? business?.cell ?? "";
  const exp = booking.items.length === 1 ? await getExperience(booking.items[0].roomId) : undefined;
  const hoursAway = Math.floor(minutesUntilFirstSession(booking) / 60);

  return (
    <>
      <h1 className="page-title">Your booking</h1>
      <p className="page-subtitle">
        Reference <strong>{booking.reference}</strong>
      </p>

      <div className="form-card" style={{ maxWidth: 640 }}>
        {booking.status === "cancelled" ? (
          <div className="manage-cancelled">
            <h3>This booking is cancelled</h3>
            <p>
              {(booking.pricing.refundedCents ?? 0) > 0
                ? `${formatMoney(booking.pricing.refundedCents ?? 0)} has been refunded to your card — allow a few business days for it to appear.`
                : (booking.pricing.refundOwedCents ?? 0) > 0
                  ? `We owe you ${formatMoney(booking.pricing.refundOwedCents ?? 0)} — our team will be in touch to return it.`
                  : "Nothing was charged."}
            </p>
            <p style={{ marginTop: 16 }}>
              <Link href="/" className="btn">
                Book another game
              </Link>
            </p>
          </div>
        ) : (
          <>
            <div className="manage-sessions">
              {booking.items.map((i, n) => (
                <div key={n} className="manage-session">
                  <div className="manage-when">
                    <strong>{formatTime(i.time)}</strong>
                    <span>{formatDateLong(i.date)}</span>
                  </div>
                  <div>
                    <div className="manage-room">{i.roomName}</div>
                    <div className="sub">
                      {i.location} · {i.quantity} guest{i.quantity === 1 ? "" : "s"} · {i.durationMinutes} minutes
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="manage-totals">
              <span>Total {formatMoney(booking.pricing.totalCents)}</span>
              <span>Paid {formatMoney(booking.pricing.paidCents)}</span>
              {booking.pricing.balanceCents > 0 && (
                <span className="due">Due at venue {formatMoney(booking.pricing.balanceCents)}</span>
              )}
            </div>

            {block.blocked ? (
              <div className="manage-locked">
                <p>{block.reason}</p>
                {phone && (
                  <p>
                    <a href={`tel:${phone}`} className="btn">
                      Call {phone}
                    </a>
                  </p>
                )}
              </div>
            ) : (
              <ManageBooking
                bookingId={booking.id}
                roomId={booking.items[0]?.roomId ?? ""}
                roomName={booking.items[0]?.roomName ?? ""}
                quantity={booking.items[0]?.quantity ?? 0}
                singleSession={booking.items.length === 1}
                paidCents={booking.pricing.paidCents}
                today={todayISO()}
                windowDays={60}
                hoursAway={hoursAway}
                phone={phone}
                canReschedule={!!exp}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
