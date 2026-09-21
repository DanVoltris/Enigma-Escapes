import { NextRequest, NextResponse } from "next/server";
import { confirmRequest, releaseRequest } from "@/lib/request-flow";
import { liveRequestsForPhone } from "@/lib/requests";
import { getBusinessDetails } from "@/lib/settings";
import { toGsmSafe, verifyTwilioSignature } from "@/lib/sms";

export const dynamic = "force-dynamic";

// Where a customer's "Y" or "N" lands. Twilio posts a form here whenever
// someone texts the venue's number; point it at this URL in the Twilio console
// (Phone Numbers → your number → A message comes in).
//
// A text carries nothing but the number it came from, so the reply is matched
// to that number's newest request awaiting an answer. Anything that isn't a
// clear yes or no gets a short nudge rather than a guess — mistaking "no thanks
// I'll rebook" for a confirmation would hold a slot nobody wants.
const YES = new Set(["y", "yes", "yeah", "yep", "yup", "confirm", "confirmed", "ok", "okay", "sure"]);
const NO = new Set(["n", "no", "nope", "cancel", "cancelled", "nah", "stop"]);

// The reply is a text Twilio bills like any other, so it gets the same GSM-7
// clean-up sendSms applies — one "—" or "’" doubles a one-segment reply.
function twiml(message: string | null): NextResponse {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${toGsmSafe(message)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/xml" } });
}

// Twilio signs the exact URL configured in its console. Behind Vercel's proxy
// req.nextUrl can carry the internal host or scheme instead, which would fail
// every signature — so the public URL is rebuilt from the forwarded headers.
function publicUrl(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Anyone can POST to a public URL; only Twilio can sign one. Without this a
  // stranger could confirm or cancel other people's bookings by guessing phone
  // numbers.
  const url = publicUrl(req);
  if (!verifyTwilioSignature(req.headers.get("x-twilio-signature"), url, raw)) {
    // Logged with the URL we checked against: a signature failure is almost
    // always a URL mismatch, and this is the one fact needed to see why.
    console.error(`inbound SMS rejected — signature did not match for ${url}`);
    return new NextResponse("Bad signature", { status: 403 });
  }

  const form = new URLSearchParams(raw);
  const from = form.get("From") ?? "";
  const word = (form.get("Body") ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!from) return twiml(null);

  const live = await liveRequestsForPhone(from);
  const waiting = live.filter((r) => r.status === "accepted");
  const request = waiting[0] ?? live.find((r) => r.status === "confirmed");

  // Two of this number's requests are waiting on a reply at once (someone
  // booking for two groups). A text says only which number it came from, so a
  // "Y" here would confirm whichever was accepted last and let the other lapse
  // — a coin toss on someone's booking. Neither is touched: staff confirm the
  // right one from the Requests page when they call.
  if (waiting.length > 1 && (YES.has(word) || NO.has(word))) {
    const phone = await getBusinessDetails()
      .then((b) => b.value?.phone || b.value?.cell || "")
      .catch(() => "");
    return twiml(
      `You have ${waiting.length} bookings waiting on a reply, so we can't tell which one you mean. ` +
        (phone ? `Please call us at ${phone} and we'll confirm the right one.` : "Please give us a call and we'll confirm the right one.")
    );
  }

  if (!request) {
    // Answer rather than sit silent: a customer texting us deserves a reply,
    // and it makes "text Y and see what comes back" a usable test of the wiring.
    return twiml(
      YES.has(word) || NO.has(word)
        ? "There's no booking waiting on a reply from this number. If you're trying to book, give us a call or visit our site."
        : "Thanks for the message — this line only takes Y/N replies to booking texts. For anything else, please give us a call."
    );
  }

  if (request.status === "confirmed") {
    return twiml(YES.has(word) ? "You're already confirmed — see you soon!" : null);
  }

  // Either can find the request already settled by the time it lands (the
  // sweep released it a moment earlier, or staff dealt with the booking) — then
  // say so, rather than stay silent about a reply that did nothing.
  const tooLate = "We couldn't update that booking by text — it changed just before your reply arrived. Please give us a call.";
  if (YES.has(word)) {
    // confirmRequest sends the real confirmation
    return twiml((await confirmRequest(request)) ? null : tooLate);
  }
  if (NO.has(word)) {
    return twiml((await releaseRequest(request, "declined-by-customer", req.nextUrl.origin)) ? null : tooLate);
  }
  return twiml("Sorry, we didn't catch that — please reply Y to confirm your booking or N to release it.");
}
