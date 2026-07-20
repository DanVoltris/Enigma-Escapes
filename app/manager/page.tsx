import Link from "next/link";
import BarChart from "@/components/manager/BarChart";
import Delta from "@/components/manager/Delta";
import StaffNotes from "@/components/manager/StaffNotes";
import RoomBadge from "@/components/RoomBadge";
import { listActivity, listBookings, listStaffNotes } from "@/lib/db";
import { addDaysISO, formatDateLong, formatMoney, formatTime, nowMinutesInBusinessTZ, todayISO } from "@/lib/format";
import { computeInsights, repeatCustomerRate } from "@/lib/insights";
import type { Booking, CartItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
] as const;

type TodayItem = { booking: Booking; item: CartItem };

export default async function ManagerDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; view?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "performance" ? "performance" : "operations";

  const bookings = await listBookings();
  const today = todayISO();

  return (
    <>
      <h1 className="mgr-page-title">Dashboard</h1>

      <nav className="mgr-subtabs" aria-label="Dashboard views">
        <Link href="/manager" className={`mgr-subtab${view === "operations" ? " active" : ""}`}>
          Operations
        </Link>
        <Link href="/manager?view=performance" className={`mgr-subtab${view === "performance" ? " active" : ""}`}>
          Venue performance
        </Link>
      </nav>

      {view === "operations" ? (
        <OperationsView bookings={bookings} today={today} />
      ) : (
        <PerformanceView bookings={bookings} today={today} rangeKey={params.range} />
      )}
    </>
  );
}

async function OperationsView({ bookings, today }: { bookings: Booking[]; today: string }) {
  const [staffNotes, activity] = await Promise.all([listStaffNotes(), listActivity(8)]);

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

  const hours = Array.from({ length: 13 }, (_, i) => i + 9);
  const guestsByHour = new Map<number, number>(hours.map((h) => [h, 0]));
  for (const t of todayItems) {
    const hour = Number(t.item.time.split(":")[0]);
    if (guestsByHour.has(hour)) guestsByHour.set(hour, (guestsByHour.get(hour) ?? 0) + t.item.quantity);
  }
  const hourBars = hours.map((h) => {
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

  const recent = bookings.slice(0, 6);

  return (
    <>
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
        <BarChart bars={hourBars} ariaLabel="Guests arriving by hour today" />
      </div>

      <div className="mgr-card">
        <h2>Still to come today</h2>
        <p className="card-sub">Sessions that have not started yet, earliest first.</p>
        {upcoming.length === 0 ? (
          <p className="mgr-empty">
            No more sessions today. <Link href="/manager/calendar">Check the calendar</Link> for the days ahead.
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

      <div className="mgr-two-col">
        <StaffNotes notes={staffNotes} />

        <div className="mgr-card">
          <h2>Recent activity</h2>
          <p className="card-sub">Changes made in the portal, newest first.</p>
          {activity.length === 0 ? (
            <p className="mgr-empty">Nothing yet. Actions like editing a room or adding a promo show up here.</p>
          ) : (
            <ul className="mgr-activity">
              {activity.map((a) => (
                <li key={a.id}>
                  <span className="act">{a.action}</span>
                  <span className="det">{a.detail}</span>
                  <span className="when">
                    {new Date(a.createdAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mgr-card">
        <h2>Latest bookings</h2>
        <p className="card-sub">The most recent bookings across all dates.</p>
        {recent.length === 0 ? (
          <p className="mgr-empty">No bookings yet.</p>
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Customer</th>
                  <th>Placed</th>
                  <th className="num">Total</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance due</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/manager/bookings/${b.id}`}>{b.reference}</Link>
                    </td>
                    <td>
                      {b.customer.firstName} {b.customer.lastName}
                    </td>
                    <td>{new Date(b.createdAt).toLocaleDateString("en-CA", { dateStyle: "medium" })}</td>
                    <td className="num">{formatMoney(b.pricing.totalCents)}</td>
                    <td className="num">{formatMoney(b.pricing.paidCents)}</td>
                    <td className="num">
                      {b.pricing.balanceCents > 0 ? (
                        <strong style={{ color: "var(--danger)" }}>{formatMoney(b.pricing.balanceCents)}</strong>
                      ) : (
                        "Paid in full"
                      )}
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

function PerformanceView({ bookings, today, rangeKey }: { bookings: Booking[]; today: string; rangeKey?: string }) {
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];
  const from = addDaysISO(today, -(range.days - 1));
  const prevTo = addDaysISO(from, -1);
  const prevFrom = addDaysISO(prevTo, -(range.days - 1));
  const cur = computeInsights(bookings, from, today);
  const prev = computeInsights(bookings, prevFrom, prevTo);
  const repeat = repeatCustomerRate(bookings);

  const activeWeekdays = cur.byWeekday.filter((w) => w.bookings > 0);
  const bestDay = activeWeekdays.reduce<(typeof activeWeekdays)[number] | null>(
    (best, w) => (!best || w.totalCents > best.totalCents ? w : best),
    null
  );
  const quietestDay =
    activeWeekdays.length > 1
      ? activeWeekdays.reduce((q, w) => (w.totalCents < q.totalCents ? w : q), activeWeekdays[0])
      : null;
  const topExperience = cur.byExperience[0] ?? null;

  const collectedPct = cur.totalCents > 0 ? Math.round((cur.collectedCents / cur.totalCents) * 100) : 0;
  const onlinePct = cur.bookings > 0 ? Math.round((cur.onlineBookings / cur.bookings) * 100) : 0;
  const noShowRate = cur.guests > 0 ? (cur.noShowGuests / cur.guests) * 100 : 0;

  return (
    <>
      <div className="mgr-actions-row">
        <div>
          <p style={{ color: "var(--text-secondary)" }}>
            Bookings placed {formatDateLong(from)} — {formatDateLong(today)}. Arrows compare with the previous{" "}
            {range.days} days.
          </p>
        </div>
        <div className="mgr-range-tabs">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={`/manager?view=performance&range=${r.key}`}
              className={`btn btn-outline${r.key === range.key ? " active" : ""}`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mgr-stats">
        <div className="mgr-stat">
          <div className="label">Bookings</div>
          <div className="value">
            {cur.bookings} <Delta cur={cur.bookings} prev={prev.bookings} />
          </div>
          <div className="hint">placed in this period</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Guests</div>
          <div className="value">
            {cur.guests} <Delta cur={cur.guests} prev={prev.guests} />
          </div>
          <div className="hint">{cur.avgGuestsPerBooking.toFixed(1)} per booking on average</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Gross sales</div>
          <div className="value">
            {formatMoney(cur.grossCents)} <Delta cur={cur.grossCents} prev={prev.grossCents} />
          </div>
          <div className="hint">before tax and discounts</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Avg. per booking</div>
          <div className="value">
            {formatMoney(cur.avgPerBookingCents)} <Delta cur={cur.avgPerBookingCents} prev={prev.avgPerBookingCents} />
          </div>
          <div className="hint">billed total incl. tax</div>
        </div>
      </div>

      <div className="mgr-two-col">
        <div className="mgr-card">
          <h2>Where the money went</h2>
          <p className="card-sub">For bookings placed in this period.</p>
          <div className="summary-totals" style={{ borderTop: "none", paddingTop: 0 }}>
            <div className="summary-line">
              <span>Gross sales</span>
              <span>{formatMoney(cur.grossCents)}</span>
            </div>
            <div className="summary-line discount">
              <span>Promo discounts</span>
              <span>-{formatMoney(cur.discountCents)}</span>
            </div>
            <div className="summary-line">
              <span>Tax collected</span>
              <span>{formatMoney(cur.gstCents)}</span>
            </div>
            <div className="summary-line total">
              <span>Total billed</span>
              <span>{formatMoney(cur.totalCents)}</span>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}>
              <span>Collected online ({collectedPct}%)</span>
              <span style={{ color: "var(--text-secondary)" }}>Balance due at venue</span>
            </div>
            <div className="mgr-meter" role="img" aria-label={`${collectedPct}% collected online`}>
              <div className="fill" style={{ width: `${collectedPct}%` }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, marginTop: 6 }}>
              <span>{formatMoney(cur.collectedCents)}</span>
              <span>{formatMoney(cur.outstandingCents)}</span>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 8 }}>
              {cur.depositBookings} paid a deposit, {cur.fullBookings} paid in full.
            </p>
          </div>
        </div>

        <div className="mgr-card">
          <h2>Highlights</h2>
          <p className="card-sub">Patterns from this period.</p>
          <div className="mgr-highlights">
            <div className="mgr-highlight">
              <div className="label">Best day of week</div>
              <div className="big">{bestDay ? bestDay.weekday : "—"}</div>
              <div className="hint">{bestDay ? `${formatMoney(bestDay.totalCents)} billed` : "no bookings yet"}</div>
            </div>
            <div className="mgr-highlight">
              <div className="label">Quietest day</div>
              <div className="big">{quietestDay ? quietestDay.weekday : "—"}</div>
              <div className="hint">
                {quietestDay ? `${formatMoney(quietestDay.totalCents)} billed` : "need more data"}
              </div>
            </div>
            <div className="mgr-highlight">
              <div className="label">Most popular experience</div>
              <div className="big">{topExperience ? topExperience.name : "—"}</div>
              <div className="hint">{topExperience ? `${topExperience.guests} guests` : "no bookings yet"}</div>
            </div>
            <div className="mgr-highlight">
              <div className="label">Repeat customers</div>
              <div className="big">{Math.round(repeat.rate * 100)}%</div>
              <div className="hint">
                {repeat.repeat} of {repeat.total} customers booked more than once (all time)
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mgr-two-col">
        <div className="mgr-card">
          <h2>Booking source</h2>
          <p className="card-sub">Online (self-serve) vs in-person / walk-in, this period.</p>
          {cur.bookings === 0 ? (
            <p className="mgr-empty">No bookings placed in this period yet.</p>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 6 }}>
                <span>Online ({onlinePct}%)</span>
                <span style={{ color: "var(--text-secondary)" }}>In-person ({100 - onlinePct}%)</span>
              </div>
              <div className="mgr-meter" role="img" aria-label={`${onlinePct}% of bookings online`}>
                <div className="fill" style={{ width: `${onlinePct}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, marginTop: 6 }}>
                <span>{cur.onlineBookings} online</span>
                <span>{cur.inPersonBookings} in-person</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 12 }}>
                Record a walk-in from <Link href="/manager/bookings/new">New walk-in booking</Link> to grow the
                in-person share.
              </p>
            </>
          )}
        </div>

        <div className="mgr-card">
          <h2>No-shows</h2>
          <p className="card-sub">Parties marked no-show, this period.</p>
          <div className="mgr-stat" style={{ borderTop: "3px solid var(--danger)" }}>
            <div className="label">No-show guests</div>
            <div className="value">{cur.noShowGuests}</div>
            <div className="hint">
              {cur.noShowBookings} booking{cur.noShowBookings === 1 ? "" : "s"} · {noShowRate.toFixed(1)}% of guests
            </div>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 12 }}>
            Mark a no-show from any booking&apos;s detail page — open one from{" "}
            <Link href="/manager/bookings">Bookings</Link>.
          </p>
        </div>
      </div>
    </>
  );
}
