// "Different times for some dates" — a room's timetable for a stretch of dates,
// one day or several, instead of its usual times. Pure, so the room form can
// check a list before saving and the server can check it again.
import type { TimePeriod } from "./types";

// The period a date runs on, if any. A period may sit wholly inside another —
// Christmas Eve inside the holiday hours — and then the inner one wins; that is
// what lets a single day be changed in the middle of a longer stretch.
export function periodFor(periods: TimePeriod[] | undefined, date: string): TimePeriod | undefined {
  let best: TimePeriod | undefined;
  for (const p of periods ?? []) {
    if (date < p.from || date > p.to) continue;
    if (!best || p.from > best.from || (p.from === best.from && p.to < best.to)) best = p;
  }
  return best;
}

// Two periods that cross without one containing the other leave the dates in
// between with no obvious answer, so they're refused. Null when the list is fine.
export function periodsProblem(periods: TimePeriod[]): string | null {
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      const a = periods[i];
      const b = periods[j];
      if (a.from === b.from && a.to === b.to) return `${a.from} – ${a.to} is listed twice.`;
      const overlap = a.from <= b.to && b.from <= a.to;
      const nested = (a.from <= b.from && b.to <= a.to) || (b.from <= a.from && a.to <= b.to);
      if (overlap && !nested) {
        return `${a.from} – ${a.to} and ${b.from} – ${b.to} overlap. One has to sit inside the other, or not touch it.`;
      }
    }
  }
  return null;
}

// The list with one date's own single-day entry set, or removed (times null).
export function withDay(periods: TimePeriod[] | undefined, date: string, times: string[] | null): TimePeriod[] {
  const rest = (periods ?? []).filter((p) => !(p.from === date && p.to === date));
  const next = times ? [...rest, { from: date, to: date, times: [...times].sort() }] : rest;
  return next.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? 1 : -1));
}
