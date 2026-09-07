import { formatTime } from "./format";
import type { BookingSource, Experience } from "./types";

// Spots left in a slot, honoring private experiences (one booking per slot).
export function remainingSpots(exp: Experience, takenGuests: number): number {
  if (exp.isPrivate) return takenGuests > 0 ? 0 : exp.capacity;
  return Math.max(0, exp.capacity - takenGuests);
}

// Largest party a single booking may have (never above capacity).
export function maxPerBooking(exp: Experience): number {
  return Math.min(exp.maxParty, exp.capacity);
}

// Smallest party a booking may have. Staff walk-ins can book any size.
export function minPerBooking(exp: Experience, source: BookingSource): number {
  return source === "in_person" ? 1 : Math.min(exp.minParty, exp.capacity);
}

// ---------- overlapping sessions ----------
//
// A start time is only free if the room is free for the WHOLE game. Availability
// used to compare exact start times, so a 60-minute game at 1:15 said nothing
// about 2:00 — and both could be sold, to two different groups, for one room.
//
// Sessions that start at exactly the same time are not an overlap: that's one
// slot, and capacity decides it. Everything else that intrudes on the running
// time is.
export type BusySession = {
  time: string; // HH:MM
  start: number; // minutes from midnight
  end: number;
  guests: number;
};

export const minutesOfTime = (time: string): number => +time.slice(0, 2) * 60 + +time.slice(3, 5);

// Past midnight wraps, so a late game's end time reads 00:15 rather than 24:15.
export const minutesToTime = (mins: number): string => {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// The session that stops `time` being bookable, or null when nothing does.
export function overlappedBy(
  busy: BusySession[] | undefined,
  time: string,
  durationMinutes: number
): BusySession | null {
  if (!busy || busy.length === 0) return null;
  const start = minutesOfTime(time);
  const end = start + durationMinutes;
  for (const s of busy) {
    if (s.start === start) continue; // same slot — capacity's business, not ours
    if (s.start < end && start < s.end) return s;
  }
  return null;
}

// Why a published start time can't take a new booking right now, keyed by time
// and worded for a dropdown label — "booked", "blocked off", "in use until
// 3:30 PM". Free times are simply absent. These are the same three checks
// create-booking makes at save, run ahead of time so the desk sees them in the
// picker rather than after a customer's details have been typed in. `blocked`
// and `booked` are keyed "roomId|time", as blockedKeysForDate and
// bookedCountsForDate produce them.
export function unavailableTimes(
  exp: Experience,
  times: string[],
  blocked: Set<string>,
  booked: Map<string, number>,
  busy: BusySession[] | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const time of times) {
    const key = `${exp.id}|${time}`;
    if (blocked.has(key)) {
      out[time] = "blocked off";
      continue;
    }
    // A game that started off-grid and runs through this time takes the room,
    // whatever this slot's own count says.
    const clash = overlappedBy(busy, time, exp.durationMinutes);
    if (clash) {
      out[time] = `in use until ${formatTime(minutesToTime(clash.end))}`;
      continue;
    }
    if (remainingSpots(exp, booked.get(key) ?? 0) === 0) {
      out[time] = exp.isPrivate ? "booked" : "full";
    }
  }
  return out;
}
