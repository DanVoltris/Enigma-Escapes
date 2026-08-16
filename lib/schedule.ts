import { parseISODate } from "./format";
import type { DayHours, DayWindow, Experience, LocationHours } from "./types";

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Day of week (0 = Sunday) for a plain YYYY-MM-DD date, venue-local.
export function weekdayOf(date: string): number {
  return parseISODate(date).getDay();
}

// Start times from `first` to `last` inclusive, stepping by interval.
function seriesInclusive(firstMin: number, lastMin: number, intervalMin: number): string[] {
  const step = Math.max(5, intervalMin);
  const out: string[] = [];
  for (let t = firstMin; t <= lastMin && out.length < 96; t += step) out.push(fromMinutes(t));
  return out;
}

// The start times an experience offers on a given date, from its schedule mode.
// `hours` is the experience's location's opening hours (needed for "store" mode).
export function startTimesFor(exp: Experience, date: string, hours?: LocationHours | null): string[] {
  // A date with its own list runs exactly that list — it replaces the weekday's
  // schedule rather than adding to it. That's what these are for: a day short of
  // staff runs fewer, differently spaced games, so the normal grid has to go,
  // not gain entries. To open one extra slot on an otherwise normal day, list
  // that day's usual times plus the extra one.
  const forDate = exp.dateTimes?.[date];
  if (forDate && forDate.length > 0) return [...forDate].sort();

  if (exp.scheduleMode === "times") {
    return [...exp.times].sort();
  }

  const dow = String(weekdayOf(date));

  if (exp.scheduleMode === "window") {
    const w: DayWindow | undefined = exp.windows[dow];
    if (!w || w.closed) return [];
    // An explicit list for this weekday beats the interval: it is exactly what
    // the customer is shown, irregular gaps and all.
    if (w.times && w.times.length > 0) return [...w.times].sort();
    const first = toMinutes(w.first);
    const last = toMinutes(w.last);
    if (last < first) return [];
    return seriesInclusive(first, last, exp.intervalMinutes);
  }

  // "store" mode: generate from the location's opening hours, last start such
  // that the game finishes by close (close − duration).
  const dh: DayHours | undefined = hours?.hours[dow];
  if (!dh || dh.closed) return [];
  const open = toMinutes(dh.open);
  const lastStart = toMinutes(dh.close) - exp.durationMinutes;
  if (lastStart < open) return [];
  return seriesInclusive(open, lastStart, exp.intervalMinutes);
}

