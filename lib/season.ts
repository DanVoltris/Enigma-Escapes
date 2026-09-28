// When a room runs at all.
//
// Most rooms run every day the venue is open. A seasonal one — Enigma's
// Christmas rooms, built in November and taken apart in January — runs only
// between two dates, and outside them must not appear on the booking site, be
// bookable at the desk, or take space on the calendar.
//
// Kept free of imports so the rule can be tested on its own, and because
// lib/schedule.ts asks it before anything else it does.
import type { Experience } from "./types";

// Both ends are inclusive, and either may stand alone: a first day with no last
// opens a room and leaves it open; a last day with no first closes it after
// that date. Dates are "YYYY-MM-DD", which compares correctly as plain text.
export function inSeason(
  exp: Pick<Experience, "availableFrom" | "availableTo">,
  date: string
): boolean {
  if (exp.availableFrom && date < exp.availableFrom) return false;
  if (exp.availableTo && date > exp.availableTo) return false;
  return true;
}
