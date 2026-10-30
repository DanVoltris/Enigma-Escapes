// What a change to a room's dated times would do to people already booked.
// A booked time quietly dropped from a date is a group that turns up to a
// session nobody can see — the rule "Times for one day" always enforced, now
// applied to every stretch of dates.
import { listBookings, listBookingsInWindow } from "./db";
import { formatDateLong, formatTime, todayISO } from "./format";
import { getLocationHours } from "./hours";
import { startTimesFor } from "./schedule";
import type { Experience, TimePeriod } from "./types";

export type Stranded = { date: string; time: string; reference: string };

export async function strandedByPeriods(exp: Experience, next: TimePeriod[]): Promise<Stranded[]> {
  const today = todayISO();
  const touched = [...(exp.timePeriods ?? []), ...next];
  if (touched.length === 0) return [];
  const start = touched.reduce((m, p) => (p.from < m ? p.from : m), touched[0].from);
  const end = touched.reduce((m, p) => (p.to > m ? p.to : m), touched[0].to);
  const from = start > today ? start : today;
  if (end < from) return []; // only the past changed

  const hours = exp.scheduleMode === "store" ? await getLocationHours(exp.location) : null;
  const after = { ...exp, timePeriods: next };
  const bookings = (await listBookingsInWindow(from, end)) ?? (await listBookings());
  const out: Stranded[] = [];
  for (const b of bookings) {
    for (const i of b.items) {
      if (i.roomId !== exp.id || i.date < from || i.date > end) continue;
      // A session booked off the grid (imported) was never on the list to lose.
      if (!startTimesFor(exp, i.date, hours).includes(i.time)) continue;
      if (!startTimesFor(after, i.date, hours).includes(i.time)) {
        out.push({ date: i.date, time: i.time, reference: b.reference });
      }
    }
  }
  return out;
}

export function strandedMessage(list: Stranded[]): string {
  const shown = list
    .slice(0, 5)
    .map((s) => `${formatDateLong(s.date)} ${formatTime(s.time)} (${s.reference})`)
    .join(", ");
  const more = list.length > 5 ? ` and ${list.length - 5} more` : "";
  return (
    `${list.length === 1 ? "A session is" : "Sessions are"} booked at ${shown}${more}, which the new times ` +
    `leave out. Keep those times, or move or cancel ${list.length === 1 ? "that booking" : "those bookings"} first.`
  );
}
