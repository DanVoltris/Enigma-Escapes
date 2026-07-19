import Link from "next/link";
import BarChart from "@/components/manager/BarChart";
import RoomBadge from "@/components/RoomBadge";
import { listBookings } from "@/lib/db";
import { formatMoney, formatTime, nowMinutesInBusinessTZ, todayISO } from "@/lib/format";
import type { Booking, CartItem } from "@/lib/types";

export const dynamic = "force-dynamic";

type TodayItem = { booking: Booking; item: CartItem };

export default async function ManagerDashboard() {
  const bookings = await listBookings();
  const today = todayISO();

  const todayItems: TodayItem[] = [];
  for (const booking of bookings) {
    for (const item of booking.items) {
      if (item.date === today) todayItems.push({ booking, item });
    }
  }

  const gamesToday = todayItems.length;
  const guestsToday = todayItems.reduce((sum, t) => sum + t.item.quantity, 0);
  const expectedRevenueToday = todayItems.reduce((sum, t) => sum + t.item.priceCents * t.item.quantity, 0);
  const newBookingsToday = bookings.filter((b) => b.createdAt.slice(0, 10) === today).length;

  // Guests by hour, 9:00 through 21:00.
  const hours = Array.from({ length: 13 }, (_, i) => i + 9);
  const guestsByHour = new Map<number, number>(hours.map((h) => [h, 0]));
  for (const t of todayItems) {
    const hour = Number(t.item.time.split(":")[0]);
    if (guestsByHour.has(hour)) guestsByHour.set(hour, (guestsByHour.get(hour) ?? 0) + t.item.quantity);
  }
  const bars = hours.map((h) => {
    const value = guestsByHour.get(h) ?? 0;
    const label = h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`;
    return { label, value, displayValue: `${value} guest${value === 1 ? "" : "s"}` };
  });

  const nowMinutes = nowMinutesInBusinessTZ();
  const upcoming = todayItems
    .filter((t) => {
      const [h, m] = t.item.time.split(":").map(Number);
      return h * 60 + m >= nowMinutes;
    })
    .sort((a, b) => a.item.time.localeCompare(b.item.time));

  return (
    <>
      <h1 className="mgr-page-title">Dashboard</h1>
      <p className="mgr-page-sub">What&apos;s happening at your venue today.</p>

      <div className="mgr-stats">
        <div className="mgr-stat">
          <div className="label">Games today</div>
          <div className="value">{gamesToday}</div>
          <div className="hint">booked sessions running today</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Guests today</div>
          <div className="value">{guestsToday}</div>
          <div className="hint">people walking through the door</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Expected revenue today</div>
          <div className="value">{formatMoney(expectedRevenueToday)}</div>
          <div className="hint">before tax and discounts</div>
        </div>
        <div className="mgr-stat">
          <div className="label">New bookings today</div>
          <div className="value">{newBookingsToday}</div>
          <div className="hint">placed today, for any date</div>
        </div>
      </div>

      <div className="mgr-card">
        <h2>Guests by hour today</h2>
        <p className="card-sub">Hover a bar for the exact count.</p>
        <BarChart bars={bars} ariaLabel="Guests arriving by hour today" />
      </div>

      <div className="mgr-card">
        <h2>Still to come today</h2>
        <p className="card-sub">Sessions that have not started yet, earliest first.</p>
        {upcoming.length === 0 ? (
          <p className="mgr-empty">
            No more sessions today.{" "}
            <Link href="/manager/calendar">Check the calendar</Link> for the days ahead.
          </p>
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Experience</th>
                  <th className="num">Guests</th>
                  <th>Booked by</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((t, i) => (
                  <tr key={i}>
                    <td>{formatTime(t.item.time)}</td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <RoomBadge name={t.item.roomName} bg={t.item.badgeBg ?? "#0B2540"} fg={t.item.badgeFg ?? "#fff"} />
                        {t.item.roomName}
                      </span>
                    </td>
                    <td className="num">{t.item.quantity}</td>
                    <td>
                      {t.booking.customer.firstName} {t.booking.customer.lastName}
                    </td>
                    <td>
                      <Link href={`/manager/bookings/${t.booking.id}`}>{t.booking.reference}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
