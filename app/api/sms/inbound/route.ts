import { NextRequest, NextResponse } from "next/server";
import { confirmRequest, releaseRequest } from "@/lib/request-flow";
import { latestRequestForPhone } from "@/lib/requests";
import { verifyTwilioSignature } from "@/lib/sms";

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

function twiml(message: string | null): NextResponse {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/xml" } });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Anyone can POST to a public URL; only Twilio can sign one. Without this a
  // stranger could confirm or cancel other people's bookings by guessing phone
  // numbers.
  if (!verifyTwilioSignature(req.headers.get("x-twilio-signature"), req.nextUrl.href, raw)) {
    return new NextResponse("Bad signature", { status: 403 });
  }

  const form = new URLSearchParams(raw);
  const from = form.get("From") ?? "";
  const word = (form.get("Body") ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!from) return twiml(null);

  const request = await latestRequestForPhone(from);
  if (!request) return twiml(null); // nothing of ours pending — stay quiet

  if (request.status === "confirmed") {
    return twiml(YES.has(word) ? "You're already confirmed — see you soon!" : null);
  }

  if (YES.has(word)) {
    await confirmRequest(request);
    return twiml(null); // confirmRequest sends the real confirmation
  }
  if (NO.has(word)) {
    await releaseRequest(request, "declined-by-customer", req.nextUrl.origin);
    return twiml(null);
  }
  return twiml("Sorry, we didn't catch that — please reply Y to confirm your booking or N to release it.");
}
