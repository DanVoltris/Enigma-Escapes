// Server-only SMS via Twilio's REST API with plain fetch (no SDK — same
// pattern as Stripe/Supabase). Keys live in environment variables only:
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (+1..., the
// Twilio number texts come from). Without them every send is a silent no-op,
// so the app runs unchanged until keys exist (keys-later, like Stripe).
import { getBusinessDetails } from "./settings";
import { formatDateLong, formatTime } from "./format";
import type { Booking } from "./types";

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM = process.env.TWILIO_FROM_NUMBER;

export function smsConfigured(): boolean {
  return Boolean(SID && TOKEN && FROM);
}

// "555-010-0200" → "+15550100200". NANP assumption (10 digits → +1); numbers
// already starting with a country code pass through.
function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.trim().startsWith("+") && digits.length >= 8) return `+${digits}`;
  return null;
}

async function sendSms(to: string, body: string): Promise<void> {
  if (!smsConfigured()) return;
  const dest = toE164(to);
  if (!dest) return;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: dest, From: FROM as string, Body: body }).toString(),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Twilio send failed (${res.status}): ${msg.slice(0, 200)}`);
  }
}

// Request decision texts (best-effort, same contract as below). The accepted
// text carries the completion link — staff also see the link in the portal in
// case SMS isn't configured yet.
export async function notifyRequestDecision(
  r: { firstName: string; phone: string; roomName: string; time: string; token: string },
  accepted: boolean,
  origin: string
): Promise<void> {
  if (!smsConfigured()) return;
  try {
    await sendSms(
      r.phone,
      accepted
        ? `Good news ${r.firstName} — your Enigma Escapes request for ${r.roomName} at ${formatTime(r.time)} is ACCEPTED! Finish your booking (payment) here: ${origin}/request/${r.token}`
        : `Hi ${r.firstName} — sorry, we can't fit ${r.roomName} at ${formatTime(r.time)} today. See other times: ${origin}`
    );
  } catch (err) {
    console.error("request decision SMS failed:", err);
  }
}

// Confirms a customer's own reschedule, with the new date and time. Also
// texts the business cell so staff see the change without watching the screen.
export async function notifyBookingRescheduled(
  booking: Booking,
  item: { roomName: string; date: string; time: string },
  origin: string
): Promise<void> {
  if (!smsConfigured()) return;
  const when = `${formatDateLong(item.date)} at ${formatTime(item.time)}`;
  try {
    await sendSms(
      booking.customer.phone,
      `Booking updated! ${item.roomName} is now ${when}. Ref ${booking.reference}. Details: ${origin}/booking/${booking.id}`
    );
  } catch (err) {
    console.error("reschedule SMS failed:", err);
  }
  try {
    const business = (await getBusinessDetails()).value;
    const staffPhone = business?.cell || business?.phone;
    if (staffPhone) {
      await sendSms(
        staffPhone,
        `Rescheduled ${booking.reference}: ${item.roomName} moved to ${when} — ${booking.customer.firstName} ${booking.customer.lastName}`
      );
    }
  } catch (err) {
    console.error("reschedule staff SMS failed:", err);
  }
}

// Confirms a customer's own cancellation.
export async function notifyBookingCancelled(booking: Booking): Promise<void> {
  if (!smsConfigured()) return;
  const first = booking.items[0];
  try {
    await sendSms(
      booking.customer.phone,
      `Your Enigma Escapes booking ${booking.reference}${first ? ` (${first.roomName})` : ""} is cancelled. Any refund follows your original payment method.`
    );
  } catch (err) {
    console.error("cancellation SMS failed:", err);
  }
  try {
    const business = (await getBusinessDetails()).value;
    const staffPhone = business?.cell || business?.phone;
    if (staffPhone) {
      await sendSms(
        staffPhone,
        `Cancelled ${booking.reference}${first ? `: ${first.roomName} ${first.date} ${formatTime(first.time)}` : ""} — ${booking.customer.firstName} ${booking.customer.lastName}`
      );
    }
  } catch (err) {
    console.error("cancellation staff SMS failed:", err);
  }
}

// Best-effort booking texts — a messaging failure must never break the booking
// (same contract as logActivity). Customer confirmation + staff heads-up.
export async function notifyBookingConfirmed(booking: Booking, origin: string): Promise<void> {
  if (!smsConfigured()) return;
  const first = booking.items[0];
  const more = booking.items.length > 1 ? ` (+${booking.items.length - 1} more)` : "";
  const link = `${origin}/confirmation/${booking.id}`;
  try {
    await sendSms(
      booking.customer.phone,
      `Booking confirmed! ${first.roomName} ${first.date} ${formatTime(first.time)}, party of ${first.quantity}${more}. Ref ${booking.reference}. Details: ${link} — change or cancel (up to 24h before): ${origin}/booking/${booking.id}`
    );
  } catch (err) {
    console.error("customer SMS failed:", err);
  }
  try {
    const business = (await getBusinessDetails()).value;
    const staffPhone = business?.cell || business?.phone;
    if (staffPhone) {
      await sendSms(
        staffPhone,
        `New booking ${booking.reference}: ${first.roomName} ${first.date} ${formatTime(first.time)}, ${first.quantity} guests${more} — ${booking.customer.firstName} ${booking.customer.lastName}`
      );
    }
  } catch (err) {
    console.error("staff SMS failed:", err);
  }
}
