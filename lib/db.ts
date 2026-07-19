import fs from "fs";
import path from "path";
import type { Booking } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_PATH = path.join(DATA_DIR, "bookings.json");

export function readBookings(): Booking[] {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // no file yet, or unreadable contents — treat as empty
  }
}

function writeBookings(bookings: Booking[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(bookings, null, 2), "utf8");
}

export function saveBooking(booking: Booking): void {
  const bookings = readBookings();
  bookings.push(booking);
  writeBookings(bookings);
}

export function getBooking(id: string): Booking | undefined {
  return readBookings().find((b) => b.id === id);
}

// People already booked into a specific slot across all stored bookings.
export function bookedCount(roomId: string, date: string, time: string): number {
  let count = 0;
  for (const booking of readBookings()) {
    for (const item of booking.items) {
      if (item.roomId === roomId && item.date === date && item.time === time) {
        count += item.quantity;
      }
    }
  }
  return count;
}
