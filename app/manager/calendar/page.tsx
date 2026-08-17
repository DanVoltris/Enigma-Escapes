import Link from "next/link";
import { allowedLocations, hasPermission, requirePermission } from "@/lib/auth";
import DateJump from "@/components/manager/DateJump";
import CalendarFilterBar from "@/components/manager/CalendarFilterBar";
import DayTimes from "@/components/manager/DayTimes";
import CalendarView, { type SessionBooking } from "@/components/manager/CalendarView";
import { blockedKeysForDate } from "@/lib/blocks";
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
  const staff = await requirePermission("calendar", "/manager/calendar");
  const scope = allowedLocations(staff); // null = every location
  const params = await searchParams;
  const today = todayISO();
  const date = params.date && isValidISODate(params.date) ? params.date : today;
  const view = params.view === "list" ? "list" : "calendar";
  const filters = (params.f ?? "").split(",").filter(Boolean);

  const [everyExperience, dayBookings, hoursMap, blockedKeys] = await Promise.all([
    listExperiences({ activeOnly: true }),
    bookingsForDate(date),
    locationHoursMap(),
    // Slots taken out of service on /manager/blocks. Availability and
    // create-booking already refuse these; the grid has to say so too, or an
    // empty cell reads as free and staff try to sell it.
    blockedKeysForDate(date),
  ]);
  // Staff assigned to particular stores only ever see those stores' rooms.
  const allExperiences = scope ? everyExperience.filter((e) => scope.includes(e.location)) : everyExperience;

  const selectedLocations = filters.filter((f) => f.startsWith("loc:")).map((f) => f.slice(4));
  const selectedRooms = filters.filter((f) => f.startsWith("room:")).map((f) => f.slice(5));
  const experiences = allExperiences.filter(
    (e) =>
      (selectedLocations.length === 0 || selectedLocations.includes(e.location)) &&
      (selectedRooms.length === 0 || selectedRooms.includes(e.id))
  );

  // Each experience's start times for the viewed date, from its schedule.
  const timesById = new Map(experiences.map((e) => [e.id, startTimesFor(e, date, hoursMap.get(e.location) ?? null)]));
  // Rows come from the published start times AND from anything actually booked
  // that day. Sessions imported from the old system often don't sit on our
  // published times, and a grid built from the schedule alone gave them no row
  // at all — the game was sold, the group was coming, and the calendar showed
  // nothing.
  const bookedTimes = dayBookings.flatMap((b) =>
    b.items.filter((i) => i.date === date).map((i) => i.time)
  );
  const allTimes = Array.from(
    new Set([...experiences.flatMap((e) => timesById.get(e.id) ?? []), ...bookedTimes])
  ).sort();
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
    <div className="mgr-wide">
      <div className="mgr-actions-row" style={{ marginBottom: 0 }}>
        <h1 className="mgr-page-title" style={{ marginBottom: 0 }}>
          Calendar
        </h1>
        {hasPermission(staff, "blocks") && (
          <Link href="/manager/blocks" className="btn btn-outline">
            Block off hours
          </Link>
        )}
      </div>

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
        <div className="cal-daynav">
          <Link href={href({ date: addDaysISO(date, -1) })} className="btn btn-outline" title="Previous day">
            ‹ Day
          </Link>
          <DateJump date={date} basePath="/manager/calendar" />
          <Link href={href({ date: addDaysISO(date, 1) })} className="btn btn-outline" title="Next day">
            Day ›
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
        blockedKeys={[...blockedKeys]}
      />

      {/* Changing a day's hours is schedule work, so it needs that permission —
          the same one that lets someone edit the room itself. */}
      {hasPermission(staff, "experiences") && view === "calendar" && (
        <DayTimes
          initialDate={date}
          viewingDate={date}
          rooms={experiences.map((e) => ({ id: e.id, name: e.name, location: e.location }))}
        />
      )}
    </div>
  );
}
