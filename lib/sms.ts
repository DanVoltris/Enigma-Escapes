// Server-only SMS via Twilio's REST API with plain fetch (no SDK — same
// pattern as Stripe/Supabase). Keys live in environment variables only:
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (+1..., the
// Twilio number texts come from). Without them every send is a silent no-op,
// so the app runs unchanged until keys exist (keys-later, like Stripe).
import { createHmac, timingSafeEqual } from "node:crypto";
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

// Twilio signs every webhook it sends with your auth token: the URL plus the
// sorted form fields, HMAC-SHA1, base64. Checking it is what stops a stranger
// POSTing "Y" for someone else's booking — the endpoint is public and the only
// thing a forged request lacks is this signature.
export function verifyTwilioSignature(header: string | null, url: string, rawBody: string): boolean {
  if (!TOKEN) return false;
  if (!header) return false;
  const form = new URLSearchParams(rawBody);
  const keys = [...new Set([...form.keys()])].sort();
  const payload = url + keys.map((k) => k + form.getAll(k).join("")).join("");
  const expected = createHmac("sha1", TOKEN).update(Buffer.from(payload, "utf8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
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
        ? `Good news ${r.firstName} — we can fit you in for ${r.roomName} at ${formatTime(r.time)}. Reply Y to confirm your spot or N to release it. We'll hold it 30 minutes. Pay when you arrive.`
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
// `notifyStaff: false` skips the heads-up to the business cell — a booking
// taken at the desk is already known to the person who took it, and texting
// them about it would buzz the owner's phone all day.
export async function notifyBookingConfirmed(
  booking: Booking,
  origin: string,
  opts?: { notifyStaff?: boolean }
): Promise<void> {
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
  if (opts?.notifyStaff === false) return;
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

// The 20%-off reward, texted the moment a booking is confirmed. Separate from
// the confirmation so a failure here can never cost the customer their booking
// confirmation — both are best-effort, but they fail independently.
export async function notifyRewardCode(
  booking: Booking,
  code: string,
  percentOff: number,
  validUntil: string
): Promise<void> {
  if (!smsConfigured()) return;
  const by = new Date(validUntil);
  const deadline = by.toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  try {
    await sendSms(
      booking.customer.phone,
      `Thanks for booking with Enigma Escapes! Here's ${percentOff}% off your next game: ${code}. Book a later session before ${deadline} to use it — it expires when your ${booking.reference} session starts.`
    );
  } catch (err) {
    console.error("reward SMS failed:", err);
  }
}

// Tells the team a booking request has landed. These are always for a session
// starting within the next few hours and they expire at session start, so
// nobody sees one unless they happen to have the Requests tab open — hence a
// text rather than a badge.
//
// Every number is tried independently: one bad number must not stop the rest
// being told, and none of it can be allowed to fail the customer's request.
export async function notifyNewRequest(
  request: {
    roomName: string;
    location: string;
    date: string;
    time: string;
    quantity: number;
    firstName: string;
    lastName: string;
    phone: string;
  },
  origin: string
): Promise<number> {
  if (!smsConfigured()) return 0;

  let numbers: string[] = [];
  try {
    const business = (await getBusinessDetails()).value;
    numbers = business?.requestAlertNumbers ?? [];
    // Nobody configured yet — fall back to the business line, so a request is
    // never silently missed just because the setting is empty.
    if (numbers.length === 0) {
      const fallback = business?.cell || business?.phone;
      if (fallback) numbers = [fallback];
    }
  } catch (err) {
    console.error("could not read request alert numbers:", err);
    return 0;
  }
  if (numbers.length === 0) return 0;

  const who = `${request.firstName} ${request.lastName}`.trim();
  const body =
    `NEW BOOKING REQUEST — ${request.roomName} (${request.location}) ` +
    `${formatDateLong(request.date)} at ${formatTime(request.time)}, ${request.quantity} guest` +
    `${request.quantity === 1 ? "" : "s"}. ${who} ${request.phone}. ` +
    `Accept or decline: ${origin}/manager/requests`;

  const results = await Promise.allSettled(numbers.map((n) => sendSms(n, body)));
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`request alert to ${numbers[i]} failed:`, r.reason);
  });
  return results.filter((r) => r.status === "fulfilled").length;
}

// Nudge at the halfway mark. Deliberately says what happens if they ignore it,
// because a reminder that doesn't is just noise.
export async function notifyReplyReminder(r: {
  firstName: string;
  phone: string;
  roomName: string;
  time: string;
}): Promise<void> {
  if (!smsConfigured()) return;
  try {
    await sendSms(
      r.phone,
      `${r.firstName}, still want ${r.roomName} at ${formatTime(r.time)}? Reply Y to confirm — we'll release the spot in 15 minutes if we don't hear back.`
    );
  } catch (err) {
    console.error("reply reminder SMS failed:", err);
  }
}

// Their spot went. Says why, and points them at booking again rather than
// leaving them wondering.
export async function notifyRequestLapsed(
  r: { firstName: string; phone: string; roomName: string; time: string },
  origin: string
): Promise<void> {
  if (!smsConfigured()) return;
  try {
    await sendSms(
      r.phone,
      `${r.firstName} — we didn't hear back, so ${r.roomName} at ${formatTime(r.time)} has been released. Book any time: ${origin}`
    );
  } catch (err) {
    console.error("lapsed request SMS failed:", err);
  }
}

// They said Y. Confirms in the terms that now matter: turn up, pay there.
export async function notifyRequestConfirmed(
  r: { firstName: string; phone: string; roomName: string; time: string; quantity: number },
  reference: string
): Promise<void> {
  if (!smsConfigured()) return;
  try {
    await sendSms(
      r.phone,
      `You're booked, ${r.firstName}! ${r.roomName} at ${formatTime(r.time)}, party of ${r.quantity}. Ref ${reference}. Payment is due when you arrive — please come 10 minutes early.`
    );
  } catch (err) {
    console.error("confirmation SMS failed:", err);
  }
}

// They said N.
export async function notifyRequestReleased(r: {
  firstName: string;
  phone: string;
  roomName: string;
  time: string;
}): Promise<void> {
  if (!smsConfigured()) return;
  try {
    await sendSms(
      r.phone,
      `No problem ${r.firstName} — ${r.roomName} at ${formatTime(r.time)} has been released. Hope to see you another time!`
    );
  } catch (err) {
    console.error("release SMS failed:", err);
  }
}
