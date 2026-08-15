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
import { formatTime } from "./format";
import {
  REPLY_DEADLINE_MINUTES,
  REPLY_REMINDER_MINUTES,
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

const minutesSince = (iso: string | null): number =>
  iso ? (Date.now() - new Date(iso).getTime()) / 60000 : 0;

// Customer said yes. The booking already exists and already holds the slot —
// this only records that they answered and tells them what happens next.
export async function confirmRequest(request: BookingRequest): Promise<void> {
  await setRequestStatus(request.id, "confirmed", request.bookingId ?? undefined);
  const booking = request.bookingId ? await getBooking(request.bookingId) : undefined;
  await notifyRequestConfirmed(request, booking?.reference ?? "—");
  await logActivity(
    "Booking request confirmed",
    `${request.roomName} ${formatTime(request.time)} — ${request.firstName} ${request.lastName} replied Y`
  );
}

// Customer said no, or ran out of time. The booking goes with it, which is what
// frees the slot — the request row alone doesn't hold anything once it's dead.
export async function releaseRequest(
  request: BookingRequest,
  reason: "declined-by-customer" | "no-reply",
  origin: string
): Promise<void> {
  if (request.bookingId) {
    try {
      // Nothing was taken, so nothing is owed back.
      await cancelBooking(request.bookingId, { owedCents: 0, refundedCents: 0 });
    } catch (err) {
      console.error("cancelling the booking behind a released request failed:", err);
    }
  }
  await setRequestStatus(request.id, "cancelled", request.bookingId ?? undefined);
  if (reason === "declined-by-customer") await notifyRequestReleased(request);
  else await notifyRequestLapsed(request, origin);
  await logActivity(
    "Booking request released",
    `${request.roomName} ${formatTime(request.time)} — ${request.firstName} ${request.lastName} — ` +
      (reason === "no-reply" ? "no reply in 30 minutes" : "customer replied N")
  );
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
    if (waited >= REPLY_DEADLINE_MINUTES) {
      await releaseRequest(request, "no-reply", origin);
      released++;
    } else if (waited >= REPLY_REMINDER_MINUTES && !request.remindedAt) {
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
