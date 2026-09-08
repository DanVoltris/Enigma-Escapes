import BarChart from "@/components/manager/BarChart";
import { leadTime, sessionHeatmap, WEEKDAYS } from "@/lib/behaviour";
import { formatTime } from "@/lib/format";
import type { Booking } from "@/lib/types";

// When demand happens: how far ahead people book, and which weekday/hour slots
// actually sell. Session-dated, like the inventory tabs — this is about the
// sessions that ran in the window, not the money taken in it.
export default function TimingTab({ bookings, from, to }: { bookings: Booking[]; from: string; to: string }) {
  const lead = leadTime(bookings, from, to);
  const heat = sessionHeatmap(bookings, from, to);
  const medianLabel =
    lead.medianDays === null
      ? "—"
      : lead.medianDays === 0
        ? "Same day"
        : `${lead.medianDays} day${lead.medianDays === 1 ? "" : "s"}`;

  return (
    <>
      <div className="rpt-tiles">
        <div className="rpt-tile">
          <div className="label">Typical lead time</div>
          <div className="value">{medianLabel}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Sessions measured</div>
          <div className="value">{lead.sessions}</div>
        </div>
      </div>

      <div className="mgr-card">
        <h2>How far ahead people book</h2>
        <p className="card-sub">
          Days between booking and playing, for sessions in this period. The typical figure is the median — half booked
          sooner, half later.
          {lead.ignored > 0 && ` ${lead.ignored} imported session${lead.ignored === 1 ? "" : "s"} dated before its own booking left out.`}
        </p>
        {lead.sessions === 0 ? (
          <p className="cust-empty">Nothing in this period.</p>
        ) : (
          <BarChart
            bars={lead.buckets.map((k) => ({ label: k.label, value: k.count, displayValue: String(k.count) }))}
            ariaLabel="Sessions by lead time"
          />
        )}
      </div>

      <div className="mgr-card">
        <h2>When sessions sell</h2>
        <p className="card-sub">
          Sessions sold by weekday and start hour. Darker is busier; a pale column is a time of day that isn&apos;t
          moving.
        </p>
        {heat.sessions === 0 ? (
          <p className="cust-empty">Nothing in this period.</p>
        ) : (
          <div className="mgr-table-wrap">
            <table className="rpt-heat" aria-label="Sessions sold by weekday and hour">
              <thead>
                <tr>
                  <th />
                  {heat.hours.map((h) => (
                    <th key={h}>{formatTime(`${String(h).padStart(2, "0")}:00`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {WEEKDAYS.map((name, weekday) => (
                  <tr key={name}>
                    <th scope="row">{name.slice(0, 3)}</th>
                    {heat.hours.map((hour) => {
                      const cell = heat.cells.find((c) => c.weekday === weekday && c.hour === hour);
                      const count = cell?.count ?? 0;
                      const level = heat.max === 0 ? 0 : Math.ceil((count / heat.max) * 5);
                      return (
                        <td key={hour} className={`heat-${level}`} title={`${name} ${formatTime(`${String(hour).padStart(2, "0")}:00`)}: ${count}`}>
                          {count || ""}
                        </td>
                      );
                    })}
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
