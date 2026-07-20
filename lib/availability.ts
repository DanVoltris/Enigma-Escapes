import { bookedCount, bookedCountsForDate } from "./db";
import { getExperience, listExperiences } from "./experiences";
import { nowMinutesInBusinessTZ, todayISO } from "./format";
import type { Slot } from "./types";

export async function slotsForDate(date: string): Promise<Slot[]> {
  const isToday = date === todayISO();
  const nowMinutes = nowMinutesInBusinessTZ();
  const [experiences, booked] = await Promise.all([
    listExperiences({ activeOnly: true }),
    bookedCountsForDate(date),
  ]);

  const slots: Slot[] = [];
  for (const exp of experiences) {
    for (const time of exp.times) {
      if (isToday) {
        const [h, m] = time.split(":").map(Number);
        if (h * 60 + m <= nowMinutes) continue; // hide start times already passed
      }
      const taken = booked.get(`${exp.id}|${time}`) ?? 0;
      slots.push({
        roomId: exp.id,
        roomName: exp.name,
        location: exp.location,
        tagline: exp.tagline,
        description: exp.description,
        date,
        time,
        durationMinutes: exp.durationMinutes,
        capacity: exp.capacity,
        remaining: Math.max(0, exp.capacity - taken),
        priceCents: exp.priceCents,
        badgeBg: exp.badgeBg,
        badgeFg: exp.badgeFg,
        imageUrl: exp.imageUrl,
      });
    }
  }

  slots.sort((a, b) => (a.time === b.time ? a.roomName.localeCompare(b.roomName) : a.time.localeCompare(b.time)));
  return slots;
}

export async function slotRemaining(roomId: string, date: string, time: string): Promise<number | null> {
  const exp = await getExperience(roomId);
  if (!exp || !exp.active || !exp.times.includes(time)) return null;
  const taken = await bookedCount(roomId, date, time);
  return Math.max(0, exp.capacity - taken);
}
