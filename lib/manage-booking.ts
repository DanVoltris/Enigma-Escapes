// Customer self-service on their own booking (the link in their confirmation
// text): reschedule to another time, or cancel. Both are refused once the
// session is inside the cutoff — at that point staff are already prepping the
// room, so it's a phone call instead.
import { remainingSpots } from "./capacity";
import { bookedCount, cancelBooking, logActivity, rescheduleBooking } from "./db";
import { getExperience } from "./experiences";
import { formatTime, minutesUntilSlot } from "./format";
import { getLocationHours } from "./hours";
import { startTimesFor } from "./schedule";
import { refundPayment, stripeConfigured } from "./stripe";
import type { Booking } from "./types";

// How close to the session self-service stops. Matches the 24-hour policy
// customers are told about on the manage page and in their text.
export const SELF_SERVICE_CUTOFF_MINUTES = 24 * 60;

// The earliest session on a booking decides whether it can still be changed.
export function minutesUntilFirstSession(booking: Booking): number {
  return Math.min(...booking.items.map((i) => minutesUntilSlot(i.date, i.time)));
}

export type ChangeBlock = { blocked: true; reason: string } | { blocked: false };

export function selfServiceBlock(booking: Booking): ChangeBlock {
  if (booking.status === "cancelled") return { blocked: true, reason: "This booking has already been cancelled." };
  const mins = minutesUntilFirstSession(booking);
  if (mins <= 0) return { blocked: true, reason: "This session has already started." };
  if (mins <= SELF_SERVICE_CUTOFF_MINUTES) {
    return {
      blocked: true,
      reason:
        "Changes aren't available within 24 hours of your session — give us a call and we'll do what we can.",
    };
  }
  return { blocked: false };
}

export type CancelOutcome = {
  booking: Booking;
  refundedCents: number; // what Stripe actually returned
  owedCents: number; // what the customer is due back in total
  automatic: boolean; // false = staff still need to refund by hand
};

// Cancels and, when Stripe is live and there's a real charge on file, refunds
// it automatically. Without Stripe the booking still cancels and the amount is
// recorded as owed so staff can settle it.
export async function cancelForCustomer(booking: Booking): Promise<CancelOutcome> {
  const owedCents = booking.pricing.paidCents;
  const intent = booking.pricing.stripePaymentIntent ?? null;
  let refundedCents = 0;

  if (owedCents > 0 && intent && stripeConfigured()) {
    try {
      refundedCents = (await refundPayment(intent, owedCents)) ?? 0;
    } catch (err) {
      // A refund failure must not trap the customer in a booking they cancelled —
      // cancel anyway and leave it flagged for staff.
      console.error("automatic refund failed:", err);
      refundedCents = 0;
    }
  }

  const updated = await cancelBooking(booking.id, { owedCents, refundedCents });
  const automatic = refundedCents >= owedCents && owedCents > 0;
  await logActivity(
    "Booking cancelled by customer",
    `${booking.reference} — ${
      owedCents === 0
        ? "nothing paid"
        : automatic
          ? `refunded ${(refundedCents / 100).toFixed(2)} automatically`
          : `REFUND OWED ${(owedCents / 100).toFixed(2)}`
    }`
  );
  return { booking: updated ?? booking, refundedCents, owedCents, automatic };
}

export type RescheduleResult = { error: string } | { items: Booking["items"] };

// Moves every session on the booking to the chosen date/time, keeping the same
// rooms, party sizes and prices. Availability is re-checked here (the customer
// could be looking at a stale page), excluding this booking's own seats.
export async function rescheduleForCustomer(
  booking: Booking,
  date: string,
  time: string
): Promise<RescheduleResult> {
  if (booking.items.length !== 1) {
    return { error: "Bookings with more than one session need a phone call to move — sorry!" };
  }
  const item = booking.items[0];
  const exp = await getExperience(item.roomId);
  if (!exp || !exp.active) return { error: "That room isn't bookable at the moment." };

  const untilNew = minutesUntilSlot(date, time);
  if (untilNew <= SELF_SERVICE_CUTOFF_MINUTES) {
    return { error: "Pick a time more than 24 hours away." };
  }
  const hours = exp.scheduleMode === "store" ? await getLocationHours(exp.location) : null;
  if (!startTimesFor(exp, date, hours).includes(time)) {
    return { error: "That time isn't offered on that day — pick another." };
  }
  const { isBlocked } = await import("./blocks");
  if (await isBlocked(exp.id, date, time)) {
    return { error: "That session isn't running — pick another time." };
  }

  // This booking's own seats shouldn't count against it when moving within
  // the same slot's day, so subtract them before checking the fit.
  const takenElsewhere =
    (await bookedCount(exp.id, date, time)) - (item.date === date && item.time === time ? item.quantity : 0);
  if (remainingSpots(exp, Math.max(0, takenElsewhere)) < item.quantity) {
    return { error: `${formatTime(time)} doesn't have room for ${item.quantity} any more — try another time.` };
  }

  const items: Booking["items"] = [{ ...item, date, time }];
  await rescheduleBooking(booking.id, items);
  await logActivity(
    "Booking rescheduled by customer",
    `${booking.reference} — ${item.roomName} moved to ${date} ${formatTime(time)}`
  );
  return { items };
}

// ---------------------------------------------------------------------------
// Staff versions. Deliberately free of the 24-hour self-service cutoff: a
// customer phoning an hour before is exactly the case staff need to handle,
// and how much (if anything) to refund is their judgement, not a rule.
// ---------------------------------------------------------------------------

// refundCents is what the staff member chose to give back: the full amount, a
// part of it, or nothing. Anything left unrefunded is recorded as owed so it
// shows on the booking rather than disappearing.
export async function cancelForStaff(
  booking: Booking,
  refundCents: number,
  staffName: string
): Promise<CancelOutcome> {
  const paidCents = booking.pricing.paidCents;
  const wanted = Math.max(0, Math.min(Math.round(refundCents), paidCents));
  const intent = booking.pricing.stripePaymentIntent ?? null;
  let refundedCents = 0;

  if (wanted > 0 && intent && stripeConfigured()) {
    try {
      refundedCents = (await refundPayment(intent, wanted)) ?? 0;
    } catch (err) {
      // Never trap a booking staff have decided to cancel — cancel it and
      // leave the money flagged for someone to settle by hand.
      console.error("staff refund failed:", err);
      refundedCents = 0;
    }
  }

  // Whatever was meant to go back but didn't is still owed.
  const owedCents = Math.max(0, wanted - refundedCents);
  const updated = await cancelBooking(booking.id, { owedCents, refundedCents });
  await logActivity(
    "Booking cancelled by staff",
    `${booking.reference} — ${staffName} — ${
      wanted === 0
        ? "no refund"
        : refundedCents >= wanted
          ? `refunded $${(refundedCents / 100).toFixed(2)}`
          : `REFUND OWED $${(owedCents / 100).toFixed(2)}`
    }`
  );
  return { booking: updated ?? booking, refundedCents, owedCents, automatic: refundedCents >= wanted && wanted > 0 };
}

// Move a booking to another slot, optionally into a different room — the
// answer to "the room's broken, put them next door". Price is carried across
// unchanged; staff re-quote deliberately rather than have it shift silently.
export async function rescheduleForStaff(
  booking: Booking,
  target: { date: string; time: string; roomId?: string },
  staffName: string
): Promise<RescheduleResult> {
  if (booking.items.length !== 1) {
    return { error: "This booking has several sessions — move them from the calendar instead." };
  }
  const item = booking.items[0];
  const roomId = target.roomId ?? item.roomId;
  const exp = await getExperience(roomId);
  if (!exp || !exp.active) return { error: "That experience isn't bookable at the moment." };

  const hours = exp.scheduleMode === "store" ? await getLocationHours(exp.location) : null;
  if (!startTimesFor(exp, target.date, hours).includes(target.time)) {
    return { error: `${exp.name} doesn't run at ${formatTime(target.time)} on that day.` };
  }
  const { isBlocked } = await import("./blocks");
  if (await isBlocked(exp.id, target.date, target.time)) {
    return { error: "That session is blocked off — unblock it first or pick another." };
  }

  // Its own seats shouldn't count against it when staying in the same slot.
  const sameSlot = item.roomId === roomId && item.date === target.date && item.time === target.time;
  const takenElsewhere = (await bookedCount(exp.id, target.date, target.time)) - (sameSlot ? item.quantity : 0);
  if (remainingSpots(exp, Math.max(0, takenElsewhere)) < item.quantity) {
    return {
      error: exp.isPrivate
        ? `${exp.name} at ${formatTime(target.time)} is already booked.`
        : `Only room for ${remainingSpots(exp, Math.max(0, takenElsewhere))} there — this booking has ${item.quantity}.`,
    };
  }

  const items: Booking["items"] = [
    {
      ...item,
      roomId: exp.id,
      roomName: exp.name,
      location: exp.location,
      badgeBg: exp.badgeBg,
      badgeFg: exp.badgeFg,
      durationMinutes: exp.durationMinutes,
      date: target.date,
      time: target.time,
    },
  ];
  await rescheduleBooking(booking.id, items);
  await logActivity(
    "Booking rescheduled by staff",
    `${booking.reference} — ${staffName} — ${item.roomName} ${item.date} ${formatTime(item.time)} → ${exp.name} ${target.date} ${formatTime(target.time)}`
  );
  return { items };
}
