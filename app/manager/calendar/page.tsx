import Link from "next/link";
import { bookedCountsForDate } from "@/lib/db";
import { listExperiences } from "@/lib/experiences";
import { addDaysISO, formatDateLong, formatTime, isValidISODate, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ManagerCalendar({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const today = todayISO();
  const date = params.date && isValidISODate(params.date) ? params.date : today;

  const [experiences, booked] = await Promise.all([
    listExperiences({ activeOnly: true }),
    bookedCountsForDate(date),
  ]);

  // Rows are every start time any experience offers that day, in order.
  const allTimes = Array.from(new Set(experiences.flatMap((e) => e.times))).sort();

  return (
    <>
      <h1 className="mgr-page-title">Calendar</h1>
      <p className="mgr-page-sub">
        Who&apos;s booked into each session. Click a session with guests to see its bookings.
      </p>

      <div className="mgr-actions-row">
        <strong style={{ fontSize: 18 }}>{date === today ? `Today — ${formatDateLong(date)}` : formatDateLong(date)}</strong>
        <div className="day-nav">
          <Link href="/manager/calendar" className="btn btn-outline">
            Today
          </Link>
          <Link href={`/manager/calendar?date=${addDaysISO(date, -1)}`} className="btn btn-outline">
            ← Prev
          </Link>
          <Link href={`/manager/calendar?date=${addDaysISO(date, 1)}`} className="btn btn-outline">
            Next →
          </Link>
        </div>
      </div>

      <div className="mgr-cal-wrap">
        <table className="mgr-cal">
          <thead>
            <tr>
              <th>Time</th>
              {experiences.map((e) => (
                <th key={e.id}>
                  {e.name}
                  <br />
                  <span style={{ fontWeight: 400 }}>{e.location}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allTimes.map((time) => (
              <tr key={time}>
                <th scope="row">{formatTime(time)}</th>
                {experiences.map((e) => {
                  if (!e.times.includes(time)) {
                    return (
                      <td key={e.id}>
                        <span className="cell na">—</span>
                      </td>
                    );
                  }
                  const count = booked.get(`${e.id}|${time}`) ?? 0;
                  const cls = count === 0 ? "" : count >= e.capacity ? " full" : " some";
                  const label = `${count}/${e.capacity}`;
                  return (
                    <td key={e.id}>
                      {count > 0 ? (
                        <Link
                          href={`/manager/bookings?date=${date}&q=${encodeURIComponent(e.name)}`}
                          className={`cell${cls}`}
                          title={`${e.name} at ${formatTime(time)}: ${count} of ${e.capacity} spots booked`}
                        >
                          {label}
                        </Link>
                      ) : (
                        <span className={`cell${cls}`}>{label}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mgr-legend">
        <span>
          <span className="chip" style={{ background: "#fff" }} /> 0 booked
        </span>
        <span>
          <span className="chip" style={{ background: "var(--accent-tint)" }} /> partly booked
        </span>
        <span>
          <span className="chip" style={{ background: "var(--accent)" }} /> full
        </span>
        <span>
          <span className="chip" style={{ background: "var(--muted-bg)" }} /> not offered at this time
        </span>
      </div>
    </>
  );
}
