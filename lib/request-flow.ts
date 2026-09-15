// What happens to an accepted request after the customer is asked to reply.
//
// The flow: request arrives and holds its slot → staff accept → customer is
// texted "reply Y or N" → they confirm (booking stands, they pay in store),
// decline, or say nothing for 30 minutes and the hold is released.
//
// All three endings live here because three different things trigger them —
// an inbound text, a staff click, and a timer — and if they each did their own
// bookkeeping they would drift apart.
import { cancelBooking, getBooking, logActivity } from "./db";
import { getSetting, saveSetting } from "./settings";
import { formatTime, minutesUntilSlot } from "./format";
import {
  replyWindow,
  markReminded,
  requestsAwaitingReply,
  setRequestStatus,
  type BookingRequest,
} from "./requests";
import {
  notifyReplyReminder,
  notifyRequestConfirmed,
  notifyRequestLapsed,
  notifyRequestReleased,
} from "./sms";
import { pushRequestConfirmed, pushRequestReleased } from "./staff-push";

const minutesSince = (iso: string | null): number =>
  iso ? (Date.now() - new Date(iso).getTime()) / 60000 : 0;

// Customer said yes. The booking already exists and already holds the slot —
// this only records that they answered and tells them what happens next.
// `by` is set when a member of staff confirms on the customer's behalf —
// someone who rings the venue instead of texting back has still confirmed, and
// before this existed the hold lapsed underneath them and cancelled a booking
// they had just been told was fine.
//
// Returns false, having done nothing, when the request is no longer awaiting a
// reply — released by the sweep a moment before the Y arrived, say. Telling
// them "you're booked" then would be telling them about a cancelled booking.
export async function confirmRequest(request: BookingRequest, by?: string): Promise<boolean> {
  if (!(await setRequestStatus(request.id, "confirmed", request.bookingId ?? undefined, "accepted"))) return false;
  const booking = request.bookingId ? await getBooking(request.bookingId) : undefined;
  await notifyRequestConfirmed(request, booking?.reference ?? "—");
  pushRequestConfirmed(request, by);
  await logActivity(
    "Booking request confirmed",
    `${request.roomName} ${formatTime(request.time)} — ${request.firstName} ${request.lastName} ` +
      (by ? `— confirmed at the desk by ${by}` : "replied Y")
  );
  return true;
}

// Customer said no, or ran out of time. The booking goes with it, which is what
// frees the slot — the request row alone doesn't hold anything once it's dead.
//
// The request is claimed first, and only while it is still awaiting a reply:
// two sweeps overlapping would otherwise both release it (two "gone back on
// sale" texts), and a sweep holding a copy loaded before the customer's Y would
// cancel a booking they had just been told was confirmed. Returns whether this
// call was the one that released it.
export async function releaseRequest(
  request: BookingRequest,
  reason: "declined-by-customer" | "no-reply",
  origin: string
): Promise<boolean> {
  // Staff may have taken the booking in hand since accepting it — taken payment
  // at the desk, moved it for someone who rang, or cancelled it themselves —
  // without pressing "They confirmed". Cancelling it now would record nothing
  // owed over money actually taken, free a slot the group still has, or wipe the
  // refund staff recorded. So the request is closed to match, and nobody is texted.
  let booking;
  try {
    booking = request.bookingId ? await getBooking(request.bookingId) : undefined;
  } catch (err) {
    console.error("loading the booking behind a request to release failed:", err);
    return false; // the next sweep tries again
  }
  if (booking) {
    const cancelled = booking.status === "cancelled";
    const moved = !booking.items.some(
      (i) => i.roomId === request.roomId && i.date === request.date && i.time === request.time
    );
    if (cancelled || moved || booking.pricing.paidCents > 0) {
      if (await setRequestStatus(request.id, cancelled ? "cancelled" : "confirmed", undefined, "accepted")) {
        await logActivity(
          "Booking request closed",
          `${request.roomName} ${formatTime(request.time)} — ${request.firstName} ${request.lastName} — ` +
            `not released: ${booking.reference} was already ${cancelled ? "cancelled" : moved ? "moved" : "paid"}`
        );
      }
      return false;
    }
  }
  if (!(await setRequestStatus(request.id, "cancelled", request.bookingId ?? undefined, "accepted"))) return false;
  if (request.bookingId) {
    try {
      // Nothing was taken, so nothing is owed back.
      await cancelBooking(request.bookingId, { owedCents: 0, refundedCents: 0 });
    } catch (err) {
      console.error("cancelling the booking behind a released request failed:", err);
    }
  }
  if (reason === "declined-by-customer") await notifyRequestReleased(request);
  else await notifyRequestLapsed(request, origin);
  pushRequestReleased(request, reason, origin);
  await logActivity(
    "Booking request released",
    `${request.roomName} ${formatTime(request.time)} — ${request.firstName} ${request.lastName} — ` +
      (reason === "no-reply" ? "no reply in 30 minutes" : "customer replied N")
  );
  return true;
}

// Run on a timer: nudge the ones halfway through their window, release the ones
// that have run out. Safe to run as often as you like — the reminder is stamped
// once, and a released request is no longer awaiting a reply.
export async function sweepAwaitingReplies(origin: string): Promise<{ reminded: number; released: number }> {
  const waiting = await requestsAwaitingReply();
  let reminded = 0;
  let released = 0;

  for (const request of waiting) {
    const waited = minutesSince(request.decidedAt);
    // The window is capped by the session itself: nothing is released once the
    // game is within minutes of starting, or has started. Those go to staff.
    const { deadline, reminderAt } = replyWindow(minutesUntilSlot(request.date, request.time), waited);
    if (deadline === null) continue;
    if (waited >= deadline) {
      if (await releaseRequest(request, "no-reply", origin)) released++;
    } else if (reminderAt !== null && waited >= reminderAt && !request.remindedAt) {
      // Stamp first, text second: if we can't record that we reminded them, we
      // don't remind them, or every sweep would send it again.
      if (await markReminded(request.id)) {
        await notifyReplyReminder(request);
        reminded++;
      }
    }
  }
  return { reminded, released };
}


// Vercel's Hobby plan only runs cron once a day, which is no use for a
// 15-minute nudge — so the sweep also rides on ordinary traffic. Anything that
// touches the booking flow can call this; it does real work at most once every
// few minutes and returns immediately otherwise.
//
// The last-run time lives in settings rather than memory because each
// serverless invocation is its own process: an in-memory guard would let every
// cold start sweep again.
const SWEEP_KEY = "requests_swept_at";
const SWEEP_EVERY_MINUTES = 3;

export async function sweepIfDue(origin: string): Promise<void> {
  try {
    const last = await getSetting<string>(SWEEP_KEY);
    if (last.value && minutesSince(last.value) < SWEEP_EVERY_MINUTES) return;
    // Claim the slot before doing the work, so most requests arriving together
    // don't both sweep. This read-then-write can still let two through (and the
    // cron route can overlap it); what stops a double send is that each reminder
    // and release claims its own request before texting.
    await saveSetting(SWEEP_KEY, new Date().toISOString());
    await sweepAwaitingReplies(origin);
  } catch (err) {
    console.error("opportunistic request sweep failed:", err); // never break the caller
  }
}
