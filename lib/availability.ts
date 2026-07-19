import { ROOMS } from "./rooms";
import { bookedCount, bookedCountsForDate } from "./db";
import { nowMinutesInBusinessTZ, todayISO } from "./format";
import type { Slot } from "./types";

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// Demo seeding: gives each slot a deterministic baseline of "already booked"
// spots so the calendar looks alive (including some sold-out slots) without a
// real booking history. Remove this once real inventory management exists.
function seededBooked(roomId: string, date: string, time: string, capacity: number): number {
  const h = hash(`${roomId}|${date}|${time}`);
  if (h % 100 < 12) return capacity; // ~12% of slots sold out
  return (h >>> 8) % 6; // otherwise 0-5 spots taken
}

export async function slotsForDate(date: string): Promise<Slot[]> {
  const isToday = date === todayISO();
  const nowMinutes = nowMinutesInBusinessTZ();
  const booked = await bookedCountsForDate(date);

  const slots: Slot[] = [];
  for (const room of ROOMS) {
    for (const time of room.times) {
      if (isToday) {
        const [h, m] = time.split(":").map(Number);
        if (h * 60 + m <= nowMinutes) continue; // hide start times already passed
      }
      const taken =
        seededBooked(room.id, date, time, room.capacity) + (booked.get(`${room.id}|${time}`) ?? 0);
      slots.push({
        roomId: room.id,
        roomName: room.name,
        location: room.location,
        tagline: room.tagline,
        description: room.description,
        date,
        time,
        durationMinutes: room.durationMinutes,
        capacity: room.capacity,
        remaining: Math.max(0, room.capacity - taken),
        priceCents: room.priceCents,
      });
    }
  }

  slots.sort((a, b) => (a.time === b.time ? a.roomName.localeCompare(b.roomName) : a.time.localeCompare(b.time)));
  return slots;
}

export async function slotRemaining(roomId: string, date: string, time: string): Promise<number | null> {
  const room = ROOMS.find((r) => r.id === roomId);
  if (!room || !room.times.includes(time)) return null;
  const taken = seededBooked(roomId, date, time, room.capacity) + (await bookedCount(roomId, date, time));
  return Math.max(0, room.capacity - taken);
}
