import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { notFound } from "next/navigation";
import BookingActions from "@/components/manager/BookingActions";
import BookingTabs, { type PurchaseLine } from "@/components/manager/BookingTabs";
import GameResultForm from "@/components/manager/GameResultForm";
import NoShowToggle from "@/components/manager/NoShowToggle";
import { getBooking, listPromos } from "@/lib/db";
import { listExperiences } from "@/lib/experiences";
import { PAYMENT_METHOD_LABEL } from "@/lib/payment-methods";
import { stripeConfigured } from "@/lib/stripe";
import { listTaxes } from "@/lib/taxes";
import { formatDateLong, formatMoney, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function initials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "?";
}

export default async function ManagerBookingDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("bookings.view", "/manager/bookings/[id]");
  const { id } = await params;
  const [booking, experiences, promos, taxes] = await Promise.all([
    getBooking(id),
    listExperiences(),
    listPromos(),
    listTaxes(),
  ]);
  if (!booking) notFound();

  const { customer, items, pricing } = booking;
  const name = `${customer.firstName} ${customer.lastName}`.trim();
  const created = new Date(booking.createdAt);
  const expMap = new Map(experiences.map((e) => [e.id, e]));

  const purchases: PurchaseLine[] = items.map((i) => ({
    roomName: i.roomName,
    imageUrl: expMap.get(i.roomId)?.imageUrl ?? null,
    badgeBg: i.badgeBg ?? "#0B2540",
    badgeFg: i.badgeFg ?? "#fff",
    when: `${formatDateLong(i.date)} · ${formatTime(i.time)}`,
    duration: `${i.durationMinutes} min`,
    quantity: i.quantity,
    amountCents: i.priceCents * i.quantity,
  }));

  const manualPayments = pricing.payments ?? [];
  // A gift voucher counts inside paidCents, so it comes out here to be listed
  // on its own — otherwise it would silently inflate the card figure.
  const voucherPaidCents = pricing.voucherRedeemed ? (pricing.voucherCents ?? 0) : 0;
  const onlinePaidCents =
    pricing.paidCents - voucherPaidCents - manualPayments.reduce((s, p) => s + p.amountCents, 0);
  const participants = customer.participants ?? [];
  const appliedTo = Array.from(new Set(items.map((i) => i.roomName))).join(", ");

  // Activity, newest first: manual payments (timestamped), then creation.
  const activity: { text: string; at: string }[] = [
    ...manualPayments.map((p) => ({
      text: `Payment of ${formatMoney(p.amountCents)} recorded (${
        PAYMENT_METHOD_LABEL[p.method]
      })${p.note ? ` — ${p.note}` : ""}`,
      at: p.at,
    })),
    ...participants.map((p) => ({ text: `Participant ${p.firstName} ${p.lastName} added`, at: p.addedAt })),
    {
      text: `${booking.source === "in_person" ? "Walk-in" : "Online"} booking created${
        booking.paymentOption === "deposit" ? " (deposit paid)" : ""
      }${booking.promoCode ? ` · promo ${booking.promoCode}` : ""}`,
      at: booking.createdAt,
    },
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <div className="cust-topbar">
        <Link href="/manager/bookings">← Back to all bookings</Link>
        <div className="bk-actions">
          <a href={`mailto:${customer.email}`}>Email customer</a>
          {/* A cancelled booking is not attending anything — no toggle, just the fact. */}
          {booking.status === "cancelled" ? (
            <span className="bk-status cancelled">Cancelled</span>
          ) : (
            <NoShowToggle id={booking.id} initial={booking.noShow} />
          )}
        </div>
      </div>

      <div className="cust-profile">
        <aside>
          <div className="cust-side">
            <div className="cust-avatar" aria-hidden="true">
              {initials(customer.firstName, customer.lastName)}
            </div>
            <h1 className="cust-name">{name}</h1>
            <p className="cust-since">
              <Link href={`/manager/customers/${encodeURIComponent(customer.email)}`}>View customer profile</Link>
            </p>

            <div className="cust-info">
              <h2>Booking {booking.reference}</h2>
              {booking.status === "cancelled" && (
                <p className="bk-cancelled-note">
                  <strong>This booking was cancelled.</strong> The spots are back on sale and nothing further is owed
                  {pricing.refundOwedCents
                    ? ` — a refund of ${formatMoney(pricing.refundOwedCents)} is still to be settled`
                    : ""}
                  .
                </p>
              )}
              {pricing.rewardVoidedAt && booking.status !== "cancelled" && (
                <p className="bk-alert-note">
                  <strong>Collect {formatMoney(pricing.rewardOwedCents ?? 0)} from this customer.</strong> Their{" "}
                  {pricing.rewardCode ? `${pricing.rewardCode} ` : ""}discount was cancelled along with the booking
                  that earned it, so this booking is back at full price. See the note below.
                </p>
              )}
              <p>
                Placed {created.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                <br />
                {booking.source === "in_person" ? "In-person / walk-in" : "Booked online"}
                <br />
                <span className="sub">
                  {booking.paymentOption === "deposit" ? "Deposit option" : "Full payment option"}
                </span>
              </p>
            </div>

            <div className="cust-info">
              <h2>Information</h2>
              <p>
                <span className="cust-info-row">
                  <span className="ico" aria-hidden="true">✉</span>
                  <a href={`mailto:${customer.email}`}>{customer.email}</a>
                </span>
                <span className="cust-info-row">
                  <span className="ico" aria-hidden="true">☎</span>
                  <a href={`tel:${customer.phone}`}>{customer.phone}</a>
                </span>
                <span className="cust-info-row">
                  <span className="ico" aria-hidden="true">✦</span>
                  <span className="sub">
                    {customer.subscribe ? "Subscribed to marketing emails" : "Not subscribed to marketing emails"}
                  </span>
                </span>
              </p>
            </div>

            <GameResultForm bookingId={booking.id} initial={booking.gameResult} />

            {booking.status !== "cancelled" && items.length === 1 && (
              <BookingActions
                bookingId={booking.id}
                paidCents={pricing.paidCents}
                stripeLive={stripeConfigured()}
                currentRoomId={items[0].roomId}
                currentDate={items[0].date}
                currentTime={items[0].time}
                rooms={experiences
                  .filter((e) => e.active)
                  .map((e) => ({ id: e.id, name: e.name, location: e.location }))}
              />
            )}
          </div>
        </aside>

        <div className="cust-main">
          <div className="mgr-card">
            <BookingTabs
              bookingId={booking.id}
              reference={booking.reference}
              purchases={purchases}
              promoCode={booking.promoCode}
              discountCents={pricing.discountCents}
              activePromos={promos.filter((p) => p.active).map((p) => ({ code: p.code, percentOff: p.percentOff }))}
              customerName={name}
              customerEmail={customer.email}
              participants={participants}
              taxes={taxes.filter((t) => t.active).map((t) => ({ name: t.name, percent: t.percent }))}
              gstCents={pricing.gstCents}
              appliedTo={appliedTo}
              payments={manualPayments}
              onlinePaidCents={onlinePaidCents}
              voucherCode={pricing.voucherCode ?? null}
              voucherPaidCents={voucherPaidCents}
              balanceCents={pricing.balanceCents}
            />

            <div className="cust-totals">
              <div>
                <div className="label">Subtotal</div>
                <div className="value">{formatMoney(pricing.subtotalCents)}</div>
              </div>
              {pricing.discountCents > 0 && (
                <div>
                  <div className="label">Discount</div>
                  <div className="value">−{formatMoney(pricing.discountCents)}</div>
                </div>
              )}
              <div>
                <div className="label">Taxes</div>
                <div className="value">{formatMoney(pricing.gstCents)}</div>
              </div>
              <div>
                <div className="label">Total</div>
                <div className="value">{formatMoney(pricing.totalCents)}</div>
              </div>
              <div>
                <div className="label">Total paid</div>
                <div className="value">{formatMoney(pricing.paidCents)}</div>
              </div>
              <div>
                <div className="label">Total due</div>
                {/* Always total − paid, so the three figures reconcile. Red only while the
                    booking is live: nothing is chased on a cancelled one. */}
                <div className={`value${pricing.balanceCents > 0 && booking.status !== "cancelled" ? " due" : ""}`}>
                  {formatMoney(pricing.balanceCents)}
                </div>
              </div>
            </div>
          </div>

          <div className="mgr-two-col">
            <div className="mgr-card">
              <h2>Activity</h2>
              <ul className="cust-activity">
                {activity.map((a, i) => (
                  <li key={i}>
                    <span className="dot" aria-hidden="true">
                      {initials(customer.firstName, customer.lastName)}
                    </span>
                    <div className="body">
                      <div>{a.text}</div>
                      <div className="when">
                        {new Date(a.at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mgr-card">
              <h2>Notes</h2>
              {booking.notes.length === 0 ? (
                <p className="cust-empty">No notes have been created yet.</p>
              ) : (
                <ul className="cust-activity">
                  {[...booking.notes]
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((n) => (
                      <li key={n.id}>
                        <span className="dot" aria-hidden="true">
                          {n.author === "System" ? "!" : initials(n.author, "")}
                        </span>
                        <div className="body">
                          <div>{n.text}</div>
                          <div className="when">
                            {n.author} ·{" "}
                            {new Date(n.at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                          </div>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
