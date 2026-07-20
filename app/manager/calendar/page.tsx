import Link from "next/link";
import RoomBadge from "@/components/RoomBadge";
import { bookedCountsForDate } from "@/lib/db";
import { listExperiences } from "@/lib/experiences";
import {
  addDaysISO,
  formatDateLong,
  formatTime,
  isValidISODate,
  nowMinutesInBusinessTZ,
  todayISO,
} from "@/lib/format";

export const dynamic = "force-dynamic";

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export default async function ManagerCalendar({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const params = await searchParams;
  const today = todayISO();
  const date = params.date && isValidISODate(params.date) ? params.date : today;
  const view = params.view === "list" ? "list" : "calendar";

  const [experiences, booked] = await Promise.all([
    listExperiences({ activeOnly: true }),
    bookedCountsForDate(date),
  ]);

  const allTimes = Array.from(new Set(experiences.flatMap((e) => e.times))).sort();
  const isToday = date === today;
  const nowMinutes = nowMinutesInBusinessTZ();

  // Preserve the chosen view when changing days.
  const viewQ = view === "list" ? "&view=list" : "";
  const todayHref = `/manager/calendar${view === "list" ? "?view=list" : ""}`;

  return (
    <>
      <h1 className="mgr-page-title">Calendar</h1>

      <nav className="mgr-subtabs" aria-label="Calendar views">
        <Link
          href={`/manager/calendar?date=${date}`}
          className={`mgr-subtab${view === "calendar" ? " active" : ""}`}
        >
          Calendar grid
        </Link>
        <Link
          href={`/manager/calendar?date=${date}&view=list`}
          className={`mgr-subtab${view === "list" ? " active" : ""}`}
        >
          List
        </Link>
      </nav>

      <div className="mgr-actions-row">
        <strong style={{ fontSize: 18 }}>
          {isToday ? `Today — ${formatDateLong(date)}` : formatDateLong(date)}
        </strong>
        <div className="day-nav">
          <Link href={todayHref} className="btn btn-outline">
            Today
          </Link>
          <Link href={`/manager/calendar?date=${addDaysISO(date, -1)}${viewQ}`} className="btn btn-outline">
            ← Prev
          </Link>
          <Link href={`/manager/calendar?date=${addDaysISO(date, 1)}${viewQ}`} className="btn btn-outline">
            Next →
          </Link>
        </div>
      </div>

      {view === "calendar" ? (
        <>
          <p className="mgr-page-sub">Who&apos;s booked into each session. Click a session with guests to see its bookings.</p>
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
      ) : (
        <ListView
          date={date}
          isToday={isToday}
          nowMinutes={nowMinutes}
          rows={experiences
            .flatMap((e) =>
              e.times.map((time) => ({
                time,
                name: e.name,
                location: e.location,
                capacity: e.capacity,
                badgeBg: e.badgeBg,
                badgeFg: e.badgeFg,
                count: booked.get(`${e.id}|${time}`) ?? 0,
              }))
            )
            .sort((a, b) => (a.time === b.time ? a.name.localeCompare(b.name) : a.time.localeCompare(b.time)))}
        />
      )}
    </>
  );
}

type Row = {
  time: string;
  name: string;
  location: string;
  capacity: number;
  badgeBg: string;
  badgeFg: string;
  count: number;
};

function ListView({
  date,
  isToday,
  nowMinutes,
  rows,
}: {
  date: string;
  isToday: boolean;
  nowMinutes: number;
  rows: Row[];
}) {
  return (
    <>
      <p className="mgr-page-sub">Every session for the day, in order. Click one with guests to see its bookings.</p>
      {rows.length === 0 ? (
        <p className="mgr-empty">No sessions scheduled for this date.</p>
      ) : (
        <div className="mgr-table-wrap">
          <table className="mgr-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Experience</th>
                <th className="num">Booked</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const passed = isToday && minutesOf(r.time) <= nowMinutes;
                const full = r.count >= r.capacity;
                let status: { label: string; cls: string };
                if (passed) status = { label: "Passed", cls: "muted" };
                else if (full) status = { label: "Full", cls: "on" };
                else if (r.count > 0) status = { label: "Filling up", cls: "" };
                else status = { label: "Available", cls: "" };

                return (
                  <tr key={i} style={passed ? { opacity: 0.6 } : undefined}>
                    <td style={{ whiteSpace: "nowrap" }}>{formatTime(r.time)}</td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <RoomBadge name={r.name} bg={r.badgeBg} fg={r.badgeFg} />
                        <span>
                          {r.name}
                          <br />
                          <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{r.location}</span>
                        </span>
                      </span>
                    </td>
                    <td className="num">
                      {r.count}/{r.capacity}
                    </td>
                    <td>
                      <span className={`mgr-pill${status.cls === "on" ? " on" : ""}`}>{status.label}</span>
                    </td>
                    <td>
                      {r.count > 0 && (
                        <Link href={`/manager/bookings?date=${date}&q=${encodeURIComponent(r.name)}`}>View bookings</Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
