// How much notice a session needs before it stops being self-serve.
//
// The venue sets a base window (Settings → Booking site). On top of that it can
// say that sessions EARLY in the day, on chosen weekdays, need more notice than
// the rest — the shift that is thinly staffed until the evening crew arrives.
// Time Zone runs 2 hours for sessions up to 4:00 PM Monday to Thursday and 1
// hour for everything else.
//
// Every surface reads the answer from here: the slot list, the checkout guard
// and the requests API, so a crafted call can't find a looser rule than the one
// the customer was shown.
import { formatTime, minutesInWords } from "./format";
import { weekdayOf, WEEKDAY_NAMES } from "./schedule";
import type { SiteSettings } from "./site-settings-defaults";

// Minutes of notice a session on `date` at `time` needs. 0 means self-serve
// right up to the start.
export function requestWindowFor(site: SiteSettings, date: string, time: string): number {
  const early = site.earlyRequestWindow;
  if (!early || early.days.length === 0) return site.requestWindowMinutes;
  if (!early.days.includes(weekdayOf(date))) return site.requestWindowMinutes;
  // `untilTime` is inclusive: "up to 4:00 PM" includes the 4:00 PM session, and
  // the next one along is on the base window.
  if (time > early.untilTime) return site.requestWindowMinutes;
  return early.minutes;
}

// "Monday to Thursday", "Monday, Wednesday and Friday" — days in words, run
// together when they are consecutive because that is how staff say it.
function daysInWords(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const names = sorted.map((d) => WEEKDAY_NAMES[d]);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (consecutive && names.length > 2) return `${names[0]} to ${names[names.length - 1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// One sentence describing the venue's rule, for the staff Requests page and the
// settings hint. Reads the same settings the guards do, so it can't drift from
// what actually happens.
export function requestWindowSentence(site: SiteSettings): string {
  const base = site.requestWindowMinutes;
  const early = site.earlyRequestWindow;
  if (base <= 0 && (!early || early.days.length === 0)) {
    return "Sessions stay bookable online right up to their start time — no requests are taken";
  }
  const main =
    base > 0
      ? `Sessions starting within ${minutesInWords(base)} can't be booked directly`
      : "Sessions can be booked online right up to their start time";
  if (!early || early.days.length === 0) return main;
  return (
    `${main} — ${minutesInWords(early.minutes)} for sessions up to ` +
    `${formatTime(early.untilTime)}, ${daysInWords(early.days)}`
  );
}
