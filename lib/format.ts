export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// "13:00" -> "1:00 PM"
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// Parse "YYYY-MM-DD" as a local date (avoids the UTC shift of new Date(string)).
export function parseISODate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// The venue's local timezone. "Today" and the booking window are evaluated
// here so the browser and the (UTC) server always agree on the date — otherwise
// an evening visitor requests their local date while the server has already
// rolled over to tomorrow in UTC, and the request gets rejected as "in the past".
export const BUSINESS_TIMEZONE = "America/Winnipeg";

function nowPartsInBusinessTZ(): { y: string; m: string; d: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), hour: Number(get("hour")), minute: Number(get("minute")) };
}

export function todayISO(): string {
  const { y, m, d } = nowPartsInBusinessTZ();
  return `${y}-${m}-${d}`;
}

// Minutes since midnight in the venue's timezone — used to hide start times
// that have already passed today.
export function nowMinutesInBusinessTZ(): number {
  const { hour, minute } = nowPartsInBusinessTZ();
  return hour * 60 + minute;
}

export function addDaysISO(date: string, days: number): string {
  const d = parseISODate(date);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "2026-07-24" -> "Fri 24 Jul 2026"
export function formatDateLong(date: string): string {
  const d = parseISODate(date);
  return d.toLocaleDateString("en-CA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Parts for the date badge on the booking panel: FRI / 24 / JUL
export function dateBadgeParts(date: string): { weekday: string; day: number; month: string } {
  const d = parseISODate(date);
  return {
    weekday: d.toLocaleDateString("en-CA", { weekday: "short" }).toUpperCase(),
    day: d.getDate(),
    month: d.toLocaleDateString("en-CA", { month: "short" }).toUpperCase(),
  };
}

export function isValidISODate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = parseISODate(date);
  return !Number.isNaN(d.getTime());
}
