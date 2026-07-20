import { remainingSpots } from "./capacity";
import { bookedCount, bookedCountsForDate } from "./db";
import { getExperience, listExperiences } from "./experiences";
import { nowMinutesInBusinessTZ, todayISO } from "./format";
import { getLocationHours, locationHoursMap } from "./hours";
import { startTimesFor } from "./schedule";
import type { Slot } from "./types";

export async function slotsForDate(date: string): Promise<Slot[]> {
  const isToday = date === todayISO();
  const nowMinutes = nowMinutesInBusinessTZ();
  const [experiences, booked, hoursMap] = await Promise.all([
    listExperiences({ activeOnly: true }),
    bookedCountsForDate(date),
    locationHoursMap(),
  ]);

  const slots: Slot[] = [];
  for (const exp of experiences) {
    const times = startTimesFor(exp, date, hoursMap.get(exp.location) ?? null);
    for (const time of times) {
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
        remaining: remainingSpots(exp, taken),
        priceCents: exp.priceCents,
        minParty: exp.minParty,
        maxParty: Math.min(exp.maxParty, exp.capacity),
        isPrivate: exp.isPrivate,
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
  if (!exp || !exp.active) return null;
  const hours = exp.scheduleMode === "store" ? await getLocationHours(exp.location) : null;
  if (!startTimesFor(exp, date, hours).includes(time)) return null;
  const taken = await bookedCount(roomId, date, time);
  return remainingSpots(exp, taken);
}
