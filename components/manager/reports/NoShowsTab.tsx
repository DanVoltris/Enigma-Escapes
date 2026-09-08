import { rate, reliability, type ReliabilityRow } from "@/lib/behaviour";
import { listBookings, listBookingsInWindow } from "@/lib/db";
import { addDaysISO } from "@/lib/format";

// Cancellations and no-shows by room and by weekday. Loads its own bookings
// because the set the Reports page shares with the other tabs deliberately
// leaves cancelled bookings out — here they are the point. Only sessions up to
// today count: a no-show can't be known for a session that hasn't happened.
export default async function NoShowsTab({
  from,
  to,
  today,
  scope,
}: {
  from: string;
  to: string;
  today: string;
  scope: string[] | null;
}) {
  const until = to < today ? to : today;
  if (from > until) {
    return <p className="mgr-empty">This window is entirely in the future — no sessions have run yet.</p>;
  }
  const loaded =
    (await listBookingsInWindow(addDaysISO(from, -1), addDaysISO(until, 1), { includeCancelled: true })) ??
    (await listBookings({ includeCancelled: true }));
  const bookings = scope
    ? loaded
        .filter((b) => b.items.some((i) => scope.includes(i.location)))
        .map((b) => ({ ...b, items: b.items.filter((i) => scope.includes(i.location)) }))
    : loaded;

  const r = reliability(bookings, from, until);
  const pct = (part: number, whole: number) => `${(rate(part, whole) * 100).toFixed(1)}%`;

  const Table = ({ rows, first }: { rows: ReliabilityRow[]; first: string }) => (
    <div className="mgr-table-wrap">
      <table className="mgr-table">
        <thead>
          <tr>
            <th>{first}</th>
            <th className="num">Sessions</th>
            <th className="num">Cancelled</th>
            <th className="num">No-shows</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .filter((row) => row.sessions > 0)
            .map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="num">{row.sessions}</td>
                <td className="num">
                  {row.cancelled} <span className="rpt-delta">({pct(row.cancelled, row.sessions)})</span>
                </td>
                <td className="num">
                  {row.noShows} <span className="rpt-delta">({pct(row.noShows, row.sessions)})</span>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="rpt-tiles">
        <div className="rpt-tile">
          <div className="label">Sessions</div>
          <div className="value">{r.totals.sessions}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Cancelled</div>
          <div className="value">{pct(r.totals.cancelled, r.totals.sessions)}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">No-shows</div>
          <div className="value">{pct(r.totals.noShows, r.totals.sessions)}</div>
        </div>
      </div>
      <p className="mgr-page-sub">
        Sessions dated in this period up to today. The owner&apos;s test bookings are left out. Cancellations are
        only reliable for bookings made here — the old system deleted its cancellations, so imported history shows
        almost none
        {r.importedCancellations > 0 ? ` (${r.importedCancellations} survived)` : ""}.
      </p>

      <div className="rpt-cards">
        <div className="mgr-card">
          <h2>By room</h2>
          {r.byRoom.length === 0 ? <p className="cust-empty">Nothing in this period.</p> : <Table rows={r.byRoom} first="Room" />}
        </div>
        <div className="mgr-card">
          <h2>By weekday</h2>
          {r.totals.sessions === 0 ? (
            <p className="cust-empty">Nothing in this period.</p>
          ) : (
            <Table rows={r.byWeekday} first="Day" />
          )}
        </div>
      </div>
    </>
  );
}
