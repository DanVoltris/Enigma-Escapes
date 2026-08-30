// Server-only SMS via Twilio's REST API with plain fetch (no SDK — same
// pattern as Stripe/Supabase). Keys live in environment variables only:
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (+1..., the
// Twilio number texts come from). Without them every send is a silent no-op,
// so the app runs unchanged until keys exist (keys-later, like Stripe).
import { createHmac, timingSafeEqual } from "node:crypto";
import { alertRecipients } from "./request-alerts";
import { getBusinessDetails, getCompanyName } from "./settings";
import { formatDateLong, formatTime, formatTimestampDate } from "./format";
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

// Characters that read the same but cost three times as much.
//
// A text is 160 characters per segment only while every character is in the
// GSM-7 alphabet. One that isn't — an em dash, a curly apostrophe, an ellipsis —
// silently re-encodes the WHOLE message as UCS-2 at 70 characters a segment,
// and Twilio bills per segment. Our copy is written in prose style, so a single
// "—" was turning a two-segment confirmation into a five-segment one.
//
// Swapped here rather than policed in the templates: this way the copy can go on
// being written naturally and can never quietly get expensive again.
const GSM_SAFE: [RegExp, string][] = [
  [/[\u2010-\u2015\u2212]/g, "-"], // ‐ ‑ ‒ – — ― and the minus sign
  [/[\u2018\u2019\u201B\u2032]/g, "'"],
  [/[\u201C\u201D\u201F\u2033]/g, '"'],
  [/\u2026/g, "..."],
  [/\u2192/g, "->"],
  [/\u00A0/g, " "], // non-breaking space
  [/[\u2022\u00B7]/g, "*"],
];

export function toGsmSafe(body: string): string {
  return GSM_SAFE.reduce((text, [re, to]) => text.replace(re, to), body);
}

async function sendSms(to: string, body: string): Promise<void> {
  if (!smsConfigured()) return;
  const dest = toE164(to);
  if (!dest) return;
  body = toGsmSafe(body);
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
      `Your ${await getCompanyName()} booking ${booking.reference}${first ? ` (${first.roomName})` : ""} is cancelled. Any refund follows your original payment method.`
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
        `Cancelled ${booking.reference}${first ? `: ${first.roomName} ${formatDateLong(first.date)} ${formatTime(first.time)}` : ""} — ${booking.customer.firstName} ${booking.customer.lastName}`
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
  try {
    await sendSms(
      booking.customer.phone,
      `Booking confirmed! ${first.roomName} ${formatDateLong(first.date)} ${formatTime(first.time)}, party of ${first.quantity}${more}. Ref ${booking.reference}. Details, changes or cancellation: ${origin}/booking/${booking.id}`
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
        `New booking ${booking.reference}: ${first.roomName} ${formatDateLong(first.date)} ${formatTime(first.time)}, ${first.quantity} guests${more}`
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
  const deadline = formatTimestampDate(validUntil);
  try {
    await sendSms(
      booking.customer.phone,
      `Thanks for booking with ${await getCompanyName()}! Here's ${percentOff}% off your next game: ${code}. Use it on a later session before ${deadline}.`
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

  // The list managers keep on the Staff page — every manager and admin with a
  // number, plus whichever staff have their switch on — and nothing else. There
  // is deliberately no fallback: an empty list means nobody is texted, which is
  // what the switches say on the tin. A hidden default would mean turning
  // everyone off and still sending, which nobody would ever debug.
  let numbers: string[] = [];
  try {
    numbers = (await alertRecipients()).map((r) => r.phone);
  } catch (err) {
    console.error("could not read the request alert list:", err);
    return 0;
  }
  if (numbers.length === 0) return 0;

  const body =
    `NEW REQUEST: ${request.roomName} (${request.location}) ` +
    `${formatDateLong(request.date)} at ${formatTime(request.time)}, ${request.quantity} guest` +
    `${request.quantity === 1 ? "" : "s"}. ${origin}/manager/requests`;

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
