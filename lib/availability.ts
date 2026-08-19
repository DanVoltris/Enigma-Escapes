import { blockedKeysForDate, isBlocked } from "./blocks";
import { overlappedBy, remainingSpots } from "./capacity";
import { bookedCount, bookedCountsForDate, busySessionsForDate } from "./db";
import { getExperience, listExperiences } from "./experiences";
import { minutesUntilSlot, nowMinutesInBusinessTZ, REQUEST_WINDOW_MINUTES, todayISO } from "./format";
import { getLocationHours, locationHoursMap } from "./hours";
import { heldSeats, heldSeatsForDate } from "./requests";
import { startTimesFor } from "./schedule";
import type { Slot } from "./types";

export async function slotsForDate(date: string): Promise<Slot[]> {
  const isToday = date === todayISO();
  const nowMinutes = nowMinutesInBusinessTZ();
  const [experiences, booked, busy, hoursMap, blocked, held] = await Promise.all([
    listExperiences({ activeOnly: true }),
    bookedCountsForDate(date),
    busySessionsForDate(date),
    locationHoursMap(),
    blockedKeysForDate(date),
    // Seats a live request is holding — someone else is mid-request for this
    // slot, so it isn't anyone else's to take yet.
    heldSeatsForDate(date),
  ]);

  const slots: Slot[] = [];
  for (const exp of experiences) {
    const times = startTimesFor(exp, date, hoursMap.get(exp.location) ?? null);
    for (const time of times) {
      if (isToday) {
        const [h, m] = time.split(":").map(Number);
        if (h * 60 + m <= nowMinutes) continue; // hide start times already passed
      }
      // Manager-blocked slots vanish from the site entirely (cleaner than
      // showing them sold out — no "why is 3pm full?" questions).
      if (blocked.has(`${exp.id}|${time}`)) continue;
      const taken = booked.get(`${exp.id}|${time}`) ?? 0;
      const onHold = held.get(`${exp.id}|${time}`) ?? 0;
      // A game running through this start time takes the room with it, whatever
      // the slot's own count says. Shown sold out rather than hidden: the time
      // is on the schedule, it just isn't free.
      const clash = overlappedBy(busy.get(exp.id), time, exp.durationMinutes);
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
        // A held seat is not a sold seat, but it is not available either.
        remaining: clash ? 0 : Math.max(0, remainingSpots(exp, taken) - onHold),
        heldSeats: onHold,
        priceCents: exp.priceCents,
        minParty: exp.minParty,
        maxParty: Math.min(exp.maxParty, exp.capacity),
        isPrivate: exp.isPrivate,
        depositPercent: exp.depositPercent,
        badgeBg: exp.badgeBg,
        badgeFg: exp.badgeFg,
        imageUrl: exp.imageUrl,
        // Starts soon → not self-serve; the customer sends a request instead.
        requestOnly: minutesUntilSlot(date, time) <= REQUEST_WINDOW_MINUTES,
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
  if (await isBlocked(roomId, date, time)) return null; // out of service
  const busy = await busySessionsForDate(date);
  if (overlappedBy(busy.get(roomId), time, exp.durationMinutes)) return 0; // room is mid-game
  const taken = await bookedCount(roomId, date, time);
  return Math.max(0, remainingSpots(exp, taken) - (await heldSeats(roomId, date, time)));
}
