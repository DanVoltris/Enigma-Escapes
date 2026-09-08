import { listBlocks } from "@/lib/blocks";
import { listBookings, listBookingsInWindow } from "@/lib/db";
import { listExperiences } from "@/lib/experiences";
import { addDaysISO, formatMoney } from "@/lib/format";
import { locationHoursMap } from "@/lib/hours";
import { opportunities, publishedSlots, suggestions, type Cell } from "@/lib/opportunities";
import { startTimesFor } from "@/lib/schedule";

// What the schedule is worth. Every other tab counts what sold; this one counts
// what was offered and didn't, because that is where the money is. Session-dated
// and only up to today — a session in the future hasn't failed to sell yet.
export default async function OpportunitiesTab({
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
  const end = to < today ? to : addDaysISO(today, -1);
  if (from > end) {
    return <p className="mgr-empty">This window is entirely in the future — nothing has had a chance to sell yet.</p>;
  }
  const days: string[] = [];
  for (let d = from; d <= end && days.length < 400; d = addDaysISO(d, 1)) days.push(d);

  const [allExperiences, hoursMap, blocks, loaded] = await Promise.all([
    listExperiences({ activeOnly: true }),
    locationHoursMap(),
    listBlocks(from),
    listBookingsInWindow(addDaysISO(from, -1), addDaysISO(end, 1)).then((r) => r ?? listBookings()),
  ]);
  const experiences = scope ? allExperiences.filter((e) => scope.includes(e.location)) : allExperiences;
  const bookings = scope
    ? loaded
        .filter((b) => b.items.some((i) => scope.includes(i.location)))
        .map((b) => ({ ...b, items: b.items.filter((i) => scope.includes(i.location)) }))
    : loaded;

  const published = publishedSlots(
    experiences,
    days,
    (exp, date) => startTimesFor(exp, date, hoursMap.get(exp.location) ?? null),
    new Set(blocks.filter((b) => b.date <= end).map((b) => `${b.roomId}|${b.date}|${b.time}`))
  );
  const o = opportunities(bookings, experiences, published, from, end, today);
  if (o.publishedSlots === 0) return <p className="mgr-empty">No sessions were published in this window.</p>;
  const ideas = suggestions(o, Math.max(1, days.length / 7));
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const Table = ({ rows, first, note }: { rows: Cell[]; first: string; note?: string }) => (
    <>
      {note && <p className="card-sub">{note}</p>}
      <div className="mgr-table-wrap">
        <table className="mgr-table">
          <thead>
            <tr>
              <th>{first}</th>
              <th className="num">Published</th>
              <th className="num">Sold</th>
              <th className="num">Fill</th>
              <th className="num">Per published session</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.label}>
                <td>{c.label}</td>
                <td className="num">{c.published}</td>
                <td className="num">{c.sold}</td>
                <td className="num">{pct(c.fill)}</td>
                <td className="num">{formatMoney(c.centsPerSlot)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <>
      <div className="rpt-tiles">
        <div className="rpt-tile">
          <div className="label">Sessions published</div>
          <div className="value">{o.publishedSlots.toLocaleString()}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Sold</div>
          <div className="value">{pct(o.fill)}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Seats used when sold</div>
          <div className="value">{pct(o.seatFill)}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Per published session</div>
          <div className="value">{formatMoney(Math.round(o.revenueCents / o.publishedSlots))}</div>
        </div>
      </div>
      <p className="mgr-page-sub">
        Sessions that were on the grid, staffable and not blocked off, against the ones that sold. Rooms are private,
        so an unsold session is the whole room lost, not a few empty seats. Sessions still in the future are left out;
        so are the owner&apos;s test bookings.
      </p>

      {ideas.length > 0 && (
        <div className="mgr-card">
          <h2>Where the money is</h2>
          <p className="card-sub">
            Ranked by what a year of each would be worth, so a weekly gain isn&apos;t buried under a one-off. Figures
            in bold are arithmetic on what the schedule already did, under the assumption printed beside them — not a
            forecast.
          </p>
          <div className="opp-list">
            {ideas.map((s) => (
              <div className="opp" key={s.id}>
                <h3>{s.title}</h3>
                {s.impactCents !== undefined && s.impactCents > 0 && (
                  <p className="opp-impact">
                    <strong>{formatMoney(s.impactCents)}</strong>
                    {s.cadence === "weekly" ? " a week" : " outstanding"}
                    {s.assumption && <span className="opp-assumption"> — {s.assumption}</span>}
                  </p>
                )}
                <p>{s.finding}</p>
                <p className="opp-action">{s.action}</p>
                <ul className="opp-evidence">
                  {s.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rpt-cards">
        <div className="mgr-card">
          <h2>Rooms</h2>
          <Table rows={o.byRoom} first="Room" note="Sorted by what each earns from a session put on the grid." />
        </div>
        <div className="mgr-card">
          <h2>Locations</h2>
          <Table rows={o.byLocation} first="Location" />
        </div>
      </div>

      <div className="rpt-cards">
        <div className="mgr-card">
          <h2>Hours that don&apos;t sell</h2>
          <Table
            rows={o.deadSquares}
            first="Day and hour"
            note="Weekday and start hour, where at least 25 sessions were published."
          />
        </div>
        <div className="mgr-card">
          <h2>Hours in demand</h2>
          <Table rows={o.bestSquares} first="Day and hour" note="The same measure, the other end. These are the hours worth charging for." />
        </div>
      </div>

      <div className="mgr-card">
        <h2>Rooms at the wrong hour</h2>
        <Table
          rows={o.deadRoomHours}
          first="Room and hour"
          note="A specific room at a specific hour, where at least 20 sessions were published. These are the individual squares to take off the grid first."
        />
      </div>

      <div className="rpt-cards">
        <div className="mgr-card">
          <h2>By weekday</h2>
          <Table rows={o.byWeekday} first="Day" />
        </div>
        <div className="mgr-card">
          <h2>By hour</h2>
          <Table rows={o.byHour} first="Hour" />
        </div>
      </div>
    </>
  );
}
