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
