import { FUNNEL_STEPS, funnel, listEventsOfKinds, pruneEvents, RETENTION_DAYS } from "@/lib/events";

// Where people stop between looking at a date and booking. Every step is
// recorded by the site itself, so it works with no marketing tools switched
// on, and counts by when the step happened.
export default async function FunnelTab({ from, to, today }: { from: string; to: string; today: string }) {
  const events = await listEventsOfKinds(
    FUNNEL_STEPS.map((s) => s.kind),
    from,
    to
  );
  if (events === null) {
    return (
      <p className="mgr-empty">
        Not set up yet — the site_events table doesn&apos;t exist. Run scripts/site-events.sql in the Supabase SQL
        editor.
      </p>
    );
  }
  void pruneEvents(today);
  const f = funnel(events);
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)}%`);
  const top = f.steps[0]?.count ?? 0;
  const last = f.steps[f.steps.length - 1]?.count ?? 0;

  return (
    <>
      <div className="rpt-tiles">
        <div className="rpt-tile">
          <div className="label">{f.byVisitor ? "Visitors who looked" : "Looks"}</div>
          <div className="value">{top}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Booked</div>
          <div className="value">{last}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Look → booked</div>
          <div className="value">{pct(top ? last / top : null)}</div>
        </div>
        {f.abandonedCarts !== null && (
          <div className="rpt-tile">
            <div className="label">Added, never booked</div>
            <div className="value">{f.abandonedCarts}</div>
          </div>
        )}
      </div>
      <p className="mgr-page-sub">
        {f.byVisitor
          ? "Counted as people, not clicks: one visitor doing a step five times is one."
          : "Counted as events for now — the visitor cookie hasn't reached the data yet, so repeated steps by one person count each time."}{" "}
        Kept for {RETENTION_DAYS} days.
      </p>

      <div className="mgr-card">
        <h2>Step by step</h2>
        {top === 0 ? (
          <p className="cust-empty">Nothing recorded in this period yet.</p>
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th className="num">{f.byVisitor ? "Visitors" : "Events"}</th>
                  <th className="num">Of previous step</th>
                  <th className="num">Of everyone who looked</th>
                </tr>
              </thead>
              <tbody>
                {f.steps.map((s) => (
                  <tr key={s.kind}>
                    <td>{s.label}</td>
                    <td className="num">{s.count}</td>
                    <td className="num">{pct(s.ofPrevious)}</td>
                    <td className="num">{pct(s.ofFirst)}</td>
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
