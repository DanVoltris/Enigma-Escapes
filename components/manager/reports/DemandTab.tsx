import { listEvents, pruneEvents, RETENTION_DAYS, unmetDemand, type DemandRow } from "@/lib/events";
import { formatDateLong } from "@/lib/format";

// Demand the venue couldn't serve: every time someone looked at a date on the
// booking site, which rooms were offered and which had nothing left. The date
// range is when they LOOKED, not the date they wanted — a look on the 3rd for
// the 20th lands on the 3rd.
export default async function DemandTab({
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
  const events = await listEvents("availability_look", from, to);
  if (events === null) {
    return (
      <p className="mgr-empty">
        Not set up yet — the site_events table doesn&apos;t exist. Run scripts/site-events.sql in the Supabase SQL
        editor.
      </p>
    );
  }
  void pruneEvents(today); // retention, on the way past — never blocks the report
  const d = unmetDemand(events, scope);
  const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(0)}%` : "—");

  const Table = ({ rows, first, soldOutLabel }: { rows: DemandRow[]; first: string; soldOutLabel: string }) => (
    <div className="mgr-table-wrap">
      <table className="mgr-table">
        <thead>
          <tr>
            <th>{first}</th>
            <th className="num">Looks</th>
            <th className="num">{soldOutLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .filter((r) => r.looks > 0)
            .map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num">{r.looks}</td>
                <td className="num">
                  {r.soldOut} <span className="rpt-delta">({pct(r.soldOut, r.looks)})</span>
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
          <div className="label">Date looks</div>
          <div className="value">{d.looks}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Nothing bookable</div>
          <div className="value">{pct(d.nothingBookable, d.looks)}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Visitors</div>
          <div className="value">{d.visitors ?? "—"}</div>
        </div>
      </div>
      <p className="mgr-page-sub">
        Each time someone on the booking site opened a date, what was offered and what was left. Counted by when they
        looked. Kept for {RETENTION_DAYS} days.
      </p>

      {d.looks === 0 ? (
        <p className="cust-empty">No looks recorded in this period yet.</p>
      ) : (
        <>
          <div className="rpt-cards">
            <div className="mgr-card">
              <h2>Rooms people wanted</h2>
              <p className="card-sub">Looks where the room was offered, and how often every start time was already gone.</p>
              <Table rows={d.byRoom} first="Room" soldOutLabel="Fully sold" />
            </div>
            <div className="mgr-card">
              <h2>Days people wanted</h2>
              <p className="card-sub">By the weekday of the date they asked for — and how often nothing at all was left.</p>
              <Table rows={d.byWeekday} first="Day" soldOutLabel="Nothing left" />
            </div>
          </div>
          {d.topDates.length > 0 && (
            <div className="mgr-card">
              <h2>Dates that turned people away</h2>
              <p className="card-sub">The dates most often opened with no room left to book.</p>
              <div className="mgr-table-wrap">
                <table className="mgr-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="num">Looks</th>
                      <th className="num">Nothing left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.topDates.map((t) => (
                      <tr key={t.date}>
                        <td>{formatDateLong(t.date)}</td>
                        <td className="num">{t.looks}</td>
                        <td className="num">{t.nothingBookable}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
