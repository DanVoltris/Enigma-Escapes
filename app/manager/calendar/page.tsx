import Link from "next/link";
import CalendarFilterBar from "@/components/manager/CalendarFilterBar";
import CalendarView, { type SessionBooking } from "@/components/manager/CalendarView";
import { bookingsForDate } from "@/lib/db";
import { listExperiences } from "@/lib/experiences";
import { locationHoursMap } from "@/lib/hours";
import { startTimesFor } from "@/lib/schedule";
import {
  addDaysISO,
  formatDateLong,
  isValidISODate,
  nowMinutesInBusinessTZ,
  todayISO,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ManagerCalendar({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; f?: string }>;
}) {
  const params = await searchParams;
  const today = todayISO();
  const date = params.date && isValidISODate(params.date) ? params.date : today;
  const view = params.view === "list" ? "list" : "calendar";
  const filters = (params.f ?? "").split(",").filter(Boolean);

  const [allExperiences, dayBookings, hoursMap] = await Promise.all([
    listExperiences({ activeOnly: true }),
    bookingsForDate(date),
    locationHoursMap(),
  ]);

  const selectedLocations = filters.filter((f) => f.startsWith("loc:")).map((f) => f.slice(4));
  const selectedRooms = filters.filter((f) => f.startsWith("room:")).map((f) => f.slice(5));
  const experiences = allExperiences.filter(
    (e) =>
      (selectedLocations.length === 0 || selectedLocations.includes(e.location)) &&
      (selectedRooms.length === 0 || selectedRooms.includes(e.id))
  );

  // Each experience's start times for the viewed date, from its schedule.
  const timesById = new Map(experiences.map((e) => [e.id, startTimesFor(e, date, hoursMap.get(e.location) ?? null)]));
  const allTimes = Array.from(new Set(experiences.flatMap((e) => timesById.get(e.id) ?? []))).sort();
  const isToday = date === today;
  const nowMinutes = nowMinutesInBusinessTZ();

  // Group the day's bookings into each session (roomId|time) for the detail
  // panel. Counts shown in the grid/list are derived from these on the client.
  const sessionsByKey: Record<string, SessionBooking[]> = {};
  for (const b of dayBookings) {
    for (const item of b.items) {
      if (item.date !== date) continue;
      const key = `${item.roomId}|${item.time}`;
      (sessionsByKey[key] ??= []).push({
        bookingId: b.id,
        reference: b.reference,
        name: `${b.customer.firstName} ${b.customer.lastName}`.trim(),
        email: b.customer.email,
        quantity: item.quantity,
        totalCents: b.pricing.totalCents,
        paidCents: b.pricing.paidCents,
        balanceCents: b.pricing.balanceCents,
        noShow: b.noShow,
        source: b.source,
      });
    }
  }
  for (const key in sessionsByKey) sessionsByKey[key].sort((a, b) => a.name.localeCompare(b.name));

  const gridExperiences = experiences.map((e) => ({
    id: e.id,
    name: e.name,
    location: e.location,
    capacity: e.capacity,
    badgeBg: e.badgeBg,
    badgeFg: e.badgeFg,
    times: timesById.get(e.id) ?? [],
  }));

  // Build hrefs that preserve date, view and filter across navigation.
  const href = (over: { date?: string; view?: string }): string => {
    const p = new URLSearchParams();
    const d = over.date ?? date;
    if (d !== today) p.set("date", d);
    const v = over.view ?? view;
    if (v === "list") p.set("view", "list");
    if (filters.length) p.set("f", filters.join(","));
    const s = p.toString();
    return `/manager/calendar${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <h1 className="mgr-page-title">Calendar</h1>

      <nav className="mgr-subtabs" aria-label="Calendar views">
        <Link href={href({ view: "calendar" })} className={`mgr-subtab${view === "calendar" ? " active" : ""}`}>
          Calendar grid
        </Link>
        <Link href={href({ view: "list" })} className={`mgr-subtab${view === "list" ? " active" : ""}`}>
          List
        </Link>
      </nav>

      <div className="mgr-actions-row">
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 18 }}>
            {isToday ? `Today — ${formatDateLong(date)}` : formatDateLong(date)}
          </strong>
          <CalendarFilterBar experiences={allExperiences.map((e) => ({ id: e.id, name: e.name, location: e.location }))} />
        </div>
        <div className="day-nav">
          <Link href={href({ date: today })} className="btn btn-outline">
            Today
          </Link>
          <Link href={href({ date: addDaysISO(date, -1) })} className="btn btn-outline">
            ← Prev
          </Link>
          <Link href={href({ date: addDaysISO(date, 1) })} className="btn btn-outline">
            Next →
          </Link>
        </div>
      </div>

      <CalendarView
        view={view}
        date={date}
        isToday={isToday}
        nowMinutes={nowMinutes}
        experiences={gridExperiences}
        allTimes={allTimes}
        sessionsByKey={sessionsByKey}
      />
    </>
  );
}
