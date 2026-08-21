// Customer self-service on their own booking (the link in their confirmation
// text): reschedule to another time, or cancel. Both are refused once the
// session is inside the cutoff — at that point staff are already prepping the
// room, so it's a phone call instead.
import { maxPerBooking, minPerBooking, minutesToTime, overlappedBy, remainingSpots } from "./capacity";
import {
  addBookingNote,
  bookedCount,
  cancelBooking,
  logActivity,
  rescheduleBooking,
  updateBookingPartySize,
} from "./db";
import { getExperience } from "./experiences";
import { formatMoney, formatTime, minutesUntilSlot } from "./format";
import { getLocationHours } from "./hours";
import { computeTotals } from "./pricing";
import { getPricingMode } from "./pricing-settings";
import { activeTaxPercent } from "./taxes";
import { startTimesFor } from "./schedule";
import { refundPayment, stripeConfigured } from "./stripe";
import { revokeRewardsFor } from "./reward-flow";
import { refundToVoucher } from "./vouchers";
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
  // Set when cancelling also killed a 20%-off reward, e.g. "VB-1234 is back at
  // full price — $18.00 to collect." Staff are told at the moment they cancel.
  rewardNote?: string | null;
};

// Cancels and, when Stripe is live and there's a real charge on file, refunds
// it automatically. Without Stripe the booking still cancels and the amount is
// recorded as owed so staff can settle it.
// Puts a booking's gift voucher balance back when it's cancelled, and reports
// how much went back. Voucher money can't be paid out to a card — it returns to
// the code the customer still holds, to spend on the next booking.
async function returnVoucher(booking: Booking): Promise<number> {
  const { voucherCode, voucherCents, voucherRedeemed } = booking.pricing;
  const cents = voucherCents ?? 0;
  if (!voucherCode || !voucherRedeemed || cents <= 0) return 0;
  try {
    const ok = await refundToVoucher(voucherCode, cents);
    if (!ok) console.error(`could not return $${(cents / 100).toFixed(2)} to voucher ${voucherCode}`);
    return ok ? cents : 0;
  } catch (err) {
    console.error(`could not return money to voucher ${voucherCode}:`, err);
    return 0;
  }
}

export async function cancelForCustomer(booking: Booking): Promise<CancelOutcome> {
  // The voucher's share goes back on the voucher; only money that actually
  // reached a card can be refunded to one.
  const voucherBackCents = await returnVoucher(booking);
  const owedCents = Math.max(0, booking.pricing.paidCents - voucherBackCents);
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
  // The reward this booking earned dies with it — and if it was already
  // spent, that booking goes back to full price.
  const rewardNote = await revokeRewardsFor(booking);
  const automatic = refundedCents >= owedCents && owedCents > 0;
  if (voucherBackCents > 0) {
    await logActivity(
      "Gift voucher balance restored",
      `${booking.reference} — $${(voucherBackCents / 100).toFixed(2)} back on ${booking.pricing.voucherCode}`
    );
  }
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
  return { booking: updated ?? booking, refundedCents, owedCents, automatic, rewardNote };
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
  // Voucher money always goes back on the voucher — there's nowhere else for it
  // to go — so the staff member's refund figure applies to the card share only.
  const voucherBackCents = await returnVoucher(booking);
  const cardPaidCents = Math.max(0, booking.pricing.paidCents - voucherBackCents);
  const wanted = Math.max(0, Math.min(Math.round(refundCents), cardPaidCents));
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

  // `owed` is the whole refund, `refunded` the part that actually went back —
  // the same reading the customer-cancel path above uses. It previously held
  // only the unsettled remainder here, so the two paths described the same
  // situation with different numbers.
  const owedCents = wanted;
  const updated = await cancelBooking(booking.id, { owedCents, refundedCents });
  // The reward this booking earned dies with it — and if it was already
  // spent, that booking goes back to full price.
  const rewardNote = await revokeRewardsFor(booking);
  if (voucherBackCents > 0) {
    await logActivity(
      "Gift voucher balance restored",
      `${booking.reference} — $${(voucherBackCents / 100).toFixed(2)} back on ${booking.pricing.voucherCode}`
    );
  }
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
  return {
    booking: updated ?? booking,
    refundedCents,
    owedCents,
    automatic: refundedCents >= wanted && wanted > 0,
    rewardNote,
  };
}

// Move a booking to another slot, optionally into a different room — the
// answer to "the room's broken, put them next door". Price is carried across
// unchanged; staff re-quote deliberately rather than have it shift silently.
// Change how many people are playing — the group that turns up with two more
// than they booked, or two fewer.
//
// The money is re-figured from the price already on the booking, not today's
// price list: the same reasoning as a staff move, which carries the original
// price across rather than silently re-quoting. Any discount they had is kept
// at the same percentage, worked back out of what was originally charged, so a
// promo that has since expired isn't quietly taken away from them.
//
// What they have paid is left alone. The balance moves instead: more guests
// means more owed at the desk, fewer means the balance drops and can go
// negative, which shows as a refund owed rather than being written off.
// `itemIndex` picks the session being changed. A booking can hold several — a
// group taking two rooms buys them on one reference — and each is resized on
// its own; the price is then rebuilt from all of them together.
export async function changePartySize(
  booking: Booking,
  quantity: number,
  staffName: string,
  itemIndex = 0
): Promise<{ items: Booking["items"]; pricing: Booking["pricing"] } | { error: string }> {
  if (booking.status === "cancelled") return { error: "This booking is cancelled." };
  const item = booking.items[itemIndex];
  if (!item) return { error: "That session is no longer on this booking." };
  const exp = await getExperience(item.roomId);
  if (!exp) return { error: "That experience no longer exists." };

  const min = minPerBooking(exp, booking.source);
  const max = maxPerBooking(exp);
  if (!Number.isInteger(quantity) || quantity < min || quantity > max) {
    return { error: `Guests must be a whole number between ${min} and ${max}.` };
  }
  if (quantity === item.quantity) return { error: `That booking is already for ${quantity}.` };

  // Only the extra seats need to fit: the ones they already hold are theirs.
  const takenElsewhere = (await bookedCount(exp.id, item.date, item.time)) - item.quantity;
  const room = remainingSpots(exp, Math.max(0, takenElsewhere));
  if (quantity > room) {
    return {
      error: exp.isPrivate
        ? `${exp.name} at ${formatTime(item.time)} only holds ${room}.`
        : `Only room for ${room} at ${formatTime(item.time)} — that slot is filling up.`,
    };
  }

  // Rebuild the totals at the new size, keeping the per-person price and the
  // effective discount rate this booking was sold at. The rate comes off the
  // whole booking, not this one session, or a two-room booking would have its
  // discount recalculated from a fraction of what it was sold at.
  const listedBefore = booking.items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  const percentOff = listedBefore > 0 ? (booking.pricing.discountCents / listedBefore) * 100 : 0;
  const items: Booking["items"] = booking.items.map((i, idx) =>
    idx === itemIndex ? { ...i, quantity } : i
  );
  // The corporate fee is charged once for the booking and is not a per-person
  // price, so it rides through a resize untouched — it is neither multiplied by
  // the new party nor dropped by the rebuild.
  const totals = computeTotals(
    items,
    percentOff,
    await activeTaxPercent(),
    await getPricingMode(),
    booking.pricing.flatFeeCents ?? 0
  );

  const paid = booking.pricing.paidCents;
  const pricing: Booking["pricing"] = {
    ...booking.pricing,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    gstCents: totals.gstCents,
    totalCents: totals.totalCents,
    balanceCents: totals.totalCents - paid,
  };

  await updateBookingPartySize(booking.id, items, pricing);
  // Named when there's more than one, so the note says which room changed.
  const which = booking.items.length > 1 ? `${item.roomName} ${formatTime(item.time)}: ` : "";
  await logActivity(
    "Party size changed by staff",
    `${booking.reference} — ${staffName} — ${which}${item.quantity} → ${quantity} guests`
  );
  await addBookingNote(
    booking.id,
    `${which}party size changed from ${item.quantity} to ${quantity}. Total is now ${formatMoney(totals.totalCents)}; ` +
      (pricing.balanceCents > 0
        ? `${formatMoney(pricing.balanceCents)} still to collect.`
        : pricing.balanceCents < 0
          ? `${formatMoney(-pricing.balanceCents)} to refund.`
          : "nothing further owed."),
    staffName
  );
  return { items, pricing };
}

export async function rescheduleForStaff(
  booking: Booking,
  target: { date: string; time: string; roomId?: string },
  staffName: string,
  itemIndex = 0
): Promise<RescheduleResult> {
  const item = booking.items[itemIndex];
  if (!item) return { error: "That session is no longer on this booking." };
  const roomId = target.roomId ?? item.roomId;
  const exp = await getExperience(roomId);
  if (!exp || !exp.active) return { error: "That experience isn't bookable at the moment." };

  // A corporate event may sit off the published grid — that's how it was booked
  // in the first place — so moving one isn't held to the room's start times
  // either. Everything that protects the room still runs below.
  const hours = exp.scheduleMode === "store" ? await getLocationHours(exp.location) : null;
  if (!booking.pricing.corporate && !startTimesFor(exp, target.date, hours).includes(target.time)) {
    return { error: `${exp.name} doesn't run at ${formatTime(target.time)} on that day.` };
  }
  const { isBlocked } = await import("./blocks");
  if (await isBlocked(exp.id, target.date, target.time)) {
    return { error: "That session is blocked off — unblock it first or pick another." };
  }

  // Free for the whole game, not just at the start. Sessions belonging to this
  // very booking are ignored — a booking can't clash with itself, and the
  // same-booking case is caught by the explicit check below with a clearer
  // message.
  const { busySessionsForDate } = await import("./db");
  const busyHere = ((await busySessionsForDate(target.date)).get(exp.id) ?? []).filter(
    (b) => !(exp.id === item.roomId && item.date === target.date && b.time === item.time)
  );
  const clash = overlappedBy(busyHere, target.time, exp.durationMinutes);
  if (clash) {
    return {
      error:
        `${exp.name} is running ${formatTime(clash.time)}–${formatTime(minutesToTime(clash.end))} that day, ` +
        `so ${formatTime(target.time)} isn't free.`,
    };
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

  // Moving one session onto another session of the same booking would have the
  // group in two places at once, and the seat check above can't see it: those
  // seats belong to this very booking.
  const sameBookingClash = booking.items.some(
    (i, idx) => idx !== itemIndex && i.roomId === exp.id && i.date === target.date && i.time === target.time
  );
  if (sameBookingClash) {
    return { error: `This booking already has ${exp.name} at ${formatTime(target.time)} that day.` };
  }

  const items: Booking["items"] = booking.items.map((i, idx) =>
    idx === itemIndex
      ? {
          ...i,
          roomId: exp.id,
          roomName: exp.name,
          location: exp.location,
          badgeBg: exp.badgeBg,
          badgeFg: exp.badgeFg,
          // The session keeps its own length. Re-stamping the room's current
          // duration here silently shrank anything that wasn't the standard
          // hour — an imported 30-minute session, or a session sold when the
          // game ran longer — and reopened the slot it was still occupying.
          durationMinutes: i.durationMinutes ?? exp.durationMinutes,
          date: target.date,
          time: target.time,
        }
      : i
  );
  await rescheduleBooking(booking.id, items);
  await logActivity(
    "Booking rescheduled by staff",
    `${booking.reference} — ${staffName} — ${item.roomName} ${item.date} ${formatTime(item.time)} → ${exp.name} ${target.date} ${formatTime(target.time)}`
  );
  return { items };
}
