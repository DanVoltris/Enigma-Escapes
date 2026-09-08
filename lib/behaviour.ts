// Behaviour reports: what customers do around a booking rather than what it
// earned — how far ahead they book, when sessions sell, who doesn't turn up,
// whether promo codes bring bigger parties, who opts in. All pure functions
// over the bookings the Reports page already loads, so each can be checked
// against live data without a browser.
import { businessDateOf, parseISODate } from "./format";
import type { Booking } from "./types";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Bookings the owner made while testing the system. Matched on the exact email
// and names used, never on "contains test" — Lauren Tester, Duncan Smartest and
// Ilena Demos are real customers and would be thrown out with that net.
const TEST_EMAILS = new Set(["murad.cheway@gmail.com"]);
const TEST_NAMES = new Set(["test test", "testing do not alter"]);

export function isTestBooking(b: Booking): boolean {
  const email = (b.customer.email ?? "").trim().toLowerCase();
  const name = `${b.customer.firstName ?? ""} ${b.customer.lastName ?? ""}`.trim().toLowerCase();
  return TEST_EMAILS.has(email) || TEST_NAMES.has(name);
}

export function withoutTests(bookings: Booking[]): Booking[] {
  return bookings.filter((b) => !isTestBooking(b));
}

// Imported from the old system. Those rows carry channel, promo and no-show
// data but no marketing opt-in, so anything about opt-ins must skip them.
export function isImported(b: Booking): boolean {
  return b.reference.startsWith("VB-L");
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((parseISODate(toDate).getTime() - parseISODate(fromDate).getTime()) / 86_400_000);
}

function weekdayOf(date: string): number {
  return parseISODate(date).getDay();
}

// --- 1. Lead time -----------------------------------------------------------

export type LeadTime = {
  sessions: number; // sessions in the window with a usable lead time
  ignored: number; // sessions dated before they were booked — import noise
  medianDays: number | null;
  buckets: { label: string; count: number }[];
};

const LEAD_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "Same day", min: 0, max: 0 },
  { label: "1–2 days", min: 1, max: 2 },
  { label: "3–6 days", min: 3, max: 6 },
  { label: "1–2 weeks", min: 7, max: 13 },
  { label: "2–4 weeks", min: 14, max: 27 },
  { label: "A month+", min: 28, max: Infinity },
];

// Days between booking and playing, for sessions dated inside the window.
// A session dated before its own booking can't be a real lead time — the
// imported data has a few — so those are counted and left out.
export function leadTime(bookings: Booking[], from: string, to: string): LeadTime {
  const leads: number[] = [];
  let ignored = 0;
  for (const b of withoutTests(bookings)) {
    const bookedOn = businessDateOf(b.createdAt);
    for (const i of b.items) {
      if (i.date < from || i.date > to) continue;
      const days = daysBetween(bookedOn, i.date);
      if (days < 0) ignored++;
      else leads.push(days);
    }
  }
  leads.sort((a, b) => a - b);
  const medianDays =
    leads.length === 0
      ? null
      : leads.length % 2
        ? leads[(leads.length - 1) / 2]
        : (leads[leads.length / 2 - 1] + leads[leads.length / 2]) / 2;
  const buckets = LEAD_BUCKETS.map((k) => ({
    label: k.label,
    count: leads.filter((d) => d >= k.min && d <= k.max).length,
  }));
  return { sessions: leads.length, ignored, medianDays, buckets };
}

// --- 6. When sessions sell ---------------------------------------------------

export type HeatCell = { weekday: number; hour: number; count: number };
export type Heatmap = { hours: number[]; cells: HeatCell[]; max: number; sessions: number };

// Sessions sold by weekday and start hour, for sessions dated in the window.
// Every room here is private, so one item is one session sold; guests would
// measure party size, not demand for the slot.
export function sessionHeatmap(bookings: Booking[], from: string, to: string): Heatmap {
  const counts = new Map<string, number>();
  const hoursSeen = new Set<number>();
  let sessions = 0;
  for (const b of withoutTests(bookings)) {
    for (const i of b.items) {
      if (i.date < from || i.date > to || !i.time) continue;
      const hour = Number(i.time.slice(0, 2));
      if (!Number.isInteger(hour)) continue;
      const key = `${weekdayOf(i.date)}|${hour}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      hoursSeen.add(hour);
      sessions++;
    }
  }
  const hours = Array.from(hoursSeen).sort((a, b) => a - b);
  const cells: HeatCell[] = [];
  let max = 0;
  for (let weekday = 0; weekday < 7; weekday++) {
    for (const hour of hours) {
      const count = counts.get(`${weekday}|${hour}`) ?? 0;
      cells.push({ weekday, hour, count });
      if (count > max) max = count;
    }
  }
  return { hours, cells, max, sessions };
}

// --- 2. Cancellations and no-shows ------------------------------------------

export type ReliabilityRow = { label: string; sessions: number; cancelled: number; noShows: number };
export type Reliability = {
  totals: ReliabilityRow;
  byRoom: ReliabilityRow[];
  byWeekday: ReliabilityRow[];
  importedCancellations: number; // the old system deleted cancellations; a handful survived
};

// Needs bookings loaded WITH cancellations — the Reports page's usual set
// leaves them out. Session-dated, and only sessions up to `until` (today):
// a no-show can't be known for a session that hasn't happened.
export function reliability(bookings: Booking[], from: string, until: string): Reliability {
  const rooms = new Map<string, ReliabilityRow>();
  const weekdays = WEEKDAYS.map((label) => ({ label, sessions: 0, cancelled: 0, noShows: 0 }));
  const totals: ReliabilityRow = { label: "All", sessions: 0, cancelled: 0, noShows: 0 };
  let importedCancellations = 0;
  for (const b of withoutTests(bookings)) {
    const cancelled = b.status === "cancelled";
    if (cancelled && isImported(b)) importedCancellations++;
    for (const i of b.items) {
      if (i.date < from || i.date > until) continue;
      const room = rooms.get(i.roomName) ?? { label: i.roomName, sessions: 0, cancelled: 0, noShows: 0 };
      const day = weekdays[weekdayOf(i.date)];
      for (const row of [room, day, totals]) {
        row.sessions++;
        if (cancelled) row.cancelled++;
        else if (b.noShow) row.noShows++;
      }
      rooms.set(i.roomName, room);
    }
  }
  const byRoom = Array.from(rooms.values()).sort((a, b) => b.sessions - a.sessions);
  return { totals, byRoom, byWeekday: weekdays, importedCancellations };
}

export function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

// --- 3. Online vs desk, week by week -----------------------------------------

export type WeekChannel = { week: string; online: number; inPerson: number }; // week = Monday's date

function mondayOf(date: string): string {
  const d = parseISODate(date);
  const back = (d.getDay() + 6) % 7; // Monday → 0, Sunday → 6
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Purchase-dated: pass the period's purchased bookings.
export function channelByWeek(purchased: Booking[]): WeekChannel[] {
  const weeks = new Map<string, WeekChannel>();
  for (const b of withoutTests(purchased)) {
    const week = mondayOf(businessDateOf(b.createdAt));
    const row = weeks.get(week) ?? { week, online: 0, inPerson: 0 };
    if (b.source === "in_person") row.inPerson++;
    else row.online++;
    weeks.set(week, row);
  }
  return Array.from(weeks.values()).sort((a, b) => a.week.localeCompare(b.week));
}

// --- 4. Promo lift --------------------------------------------------------------

export type PromoGroup = { bookings: number; avgGuests: number; avgSpendCents: number };
export type PromoLift = { withCode: PromoGroup; withoutCode: PromoGroup; byCode: (PromoGroup & { code: string })[] };

function group(list: Booking[]): PromoGroup {
  const guests = list.reduce((s, b) => s + b.items.reduce((t, i) => t + i.quantity, 0), 0);
  const spend = list.reduce((s, b) => s + b.pricing.totalCents, 0);
  return {
    bookings: list.length,
    avgGuests: list.length ? guests / list.length : 0,
    avgSpendCents: list.length ? Math.round(spend / list.length) : 0,
  };
}

// Does a code bring a bigger party or a bigger bill than a booking without one?
// Spend is the billed total after the discount — what the venue actually got.
export function promoLift(purchased: Booking[]): PromoLift {
  const clean = withoutTests(purchased);
  const withList = clean.filter((b) => b.promoCode);
  const codes = new Map<string, Booking[]>();
  for (const b of withList) {
    const code = (b.promoCode as string).toUpperCase();
    codes.set(code, [...(codes.get(code) ?? []), b]);
  }
  return {
    withCode: group(withList),
    withoutCode: group(clean.filter((b) => !b.promoCode)),
    byCode: Array.from(codes.entries())
      .map(([code, list]) => ({ code, ...group(list) }))
      .sort((a, b) => b.bookings - a.bookings),
  };
}

// --- 5. Marketing opt-in ---------------------------------------------------------

export type OptInRow = { label: string; total: number; optedIn: number };
export type OptIn = { total: number; optedIn: number; bySource: OptInRow[]; byRoom: OptInRow[] };

// Native bookings only: the imported rows have no opt-in field, so counting
// them would report a rate of nearly zero that means nothing.
export function optIn(purchased: Booking[]): OptIn {
  const native = withoutTests(purchased).filter((b) => !isImported(b));
  const bySource = new Map<string, OptInRow>([
    ["Booking site", { label: "Booking site", total: 0, optedIn: 0 }],
    ["Walk-in", { label: "Walk-in", total: 0, optedIn: 0 }],
  ]);
  const byRoom = new Map<string, OptInRow>();
  let optedIn = 0;
  for (const b of native) {
    const yes = b.customer.subscribe === true;
    if (yes) optedIn++;
    const src = bySource.get(b.source === "in_person" ? "Walk-in" : "Booking site")!;
    src.total++;
    if (yes) src.optedIn++;
    const roomName = b.items[0]?.roomName;
    if (roomName) {
      const row = byRoom.get(roomName) ?? { label: roomName, total: 0, optedIn: 0 };
      row.total++;
      if (yes) row.optedIn++;
      byRoom.set(roomName, row);
    }
  }
  return {
    total: native.length,
    optedIn,
    bySource: Array.from(bySource.values()),
    byRoom: Array.from(byRoom.values()).sort((a, b) => b.total - a.total),
  };
}
