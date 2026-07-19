import Link from "next/link";
import BarChart from "@/components/manager/BarChart";
import { listBookings } from "@/lib/db";
import { addDaysISO, formatDateLong, formatMoney, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
] as const;

export default async function ManagerReports({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const range = RANGES.find((r) => r.key === params.range) ?? RANGES[1];
  const today = todayISO();
  const from = addDaysISO(today, -(range.days - 1));

  const bookings = await listBookings();

  // Everything here is keyed by GAME date (when the session runs), not by when
  // the booking was placed.
  type ExpAgg = { name: string; sessions: number; guests: number; grossCents: number };
  const byExperience = new Map<string, ExpAgg>();
  const grossByDay = new Map<string, number>();
  let sessions = 0;
  let guests = 0;
  let grossCents = 0;
  const bookingIds = new Set<string>();

  for (const b of bookings) {
    for (const item of b.items) {
      if (item.date < from || item.date > today) continue;
      const itemGross = item.priceCents * item.quantity;
      sessions += 1;
      guests += item.quantity;
      grossCents += itemGross;
      bookingIds.add(b.id);
      grossByDay.set(item.date, (grossByDay.get(item.date) ?? 0) + itemGross);
      const agg = byExperience.get(item.roomId) ?? { name: item.roomName, sessions: 0, guests: 0, grossCents: 0 };
      agg.sessions += 1;
      agg.guests += item.quantity;
      agg.grossCents += itemGross;
      byExperience.set(item.roomId, agg);
    }
  }

  // One bar per day across the range (7/30/90 bars).
  const bars = [];
  for (let i = 0; i < range.days; i++) {
    const d = addDaysISO(from, i);
    const value = grossByDay.get(d) ?? 0;
    const dayNum = Number(d.slice(8, 10));
    bars.push({
      label: range.days === 7 ? formatDateLong(d).slice(0, 3) : dayNum === 1 || i === 0 ? d.slice(5) : String(dayNum),
      value,
      displayValue: `${formatDateLong(d)}: ${formatMoney(value)}`,
    });
  }

  const experienceRows = Array.from(byExperience.values()).sort((a, b) => b.grossCents - a.grossCents);

  return (
    <>
      <h1 className="mgr-page-title">Reports</h1>
      <p className="mgr-page-sub">
        Sales by the date sessions run (not the date they were booked). Gross = ticket price × guests,
        before tax and discounts.
      </p>

      <div className="mgr-actions-row">
        <strong style={{ fontSize: 16 }}>
          {formatDateLong(from)} — {formatDateLong(today)}
        </strong>
        <div className="mgr-range-tabs">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={`/manager/reports?range=${r.key}`}
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
          <div className="value">{bookingIds.size}</div>
          <div className="hint">with a session in this period</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Sessions run</div>
          <div className="value">{sessions}</div>
          <div className="hint">booked game slots</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Guests</div>
          <div className="value">{guests}</div>
          <div className="hint">total players</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Gross sales</div>
          <div className="value">{formatMoney(grossCents)}</div>
          <div className="hint">before tax and discounts</div>
        </div>
      </div>

      <div className="mgr-card">
        <h2>Gross sales by day</h2>
        <p className="card-sub">Hover a bar for the exact amount.</p>
        <BarChart bars={bars} ariaLabel={`Gross sales by day, ${range.label.toLowerCase()}`} />
      </div>

      <div className="mgr-card">
        <h2>By experience</h2>
        <p className="card-sub">Which rooms earn the most in this period.</p>
        {experienceRows.length === 0 ? (
          <p className="mgr-empty">No sessions in this period yet.</p>
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Experience</th>
                  <th className="num">Sessions</th>
                  <th className="num">Guests</th>
                  <th className="num">Gross sales</th>
                </tr>
              </thead>
              <tbody>
                {experienceRows.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td className="num">{r.sessions}</td>
                    <td className="num">{r.guests}</td>
                    <td className="num">{formatMoney(r.grossCents)}</td>
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
