import { NextRequest, NextResponse } from "next/server";
import { markSmsStatus, type SmsStatus } from "@/lib/sms-log";
import { verifyTwilioSignature } from "@/lib/sms";

export const dynamic = "force-dynamic";

// Where Twilio says what became of a text it accepted from us.
//
// Sending a message only ever gets "queued" back. Minutes later Twilio posts
// here with the real outcome — delivered, or the carrier's reason for dropping
// it — and that is the only way the app can ever tell staff that a customer's
// confirmation never arrived. Nothing here changes a booking; it writes one
// row of history.
//
// Twilio retries a callback it can't deliver, so this must stay idempotent:
// markSmsStatus matches on Twilio's own message id and refuses to walk a
// delivered message back to "sent" when callbacks arrive out of order.

// Twilio signs the exact URL configured against the message. Behind Vercel's
// proxy req.nextUrl can carry the internal host, which would fail every
// signature — so the public URL is rebuilt from the forwarded headers, exactly
// as the inbound-message webhook does.
function publicUrl(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
}

const KNOWN = new Set<SmsStatus>(["queued", "sent", "delivered", "undelivered", "failed"]);

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const url = publicUrl(req);
  if (!verifyTwilioSignature(req.headers.get("x-twilio-signature"), url, raw)) {
    console.error(`SMS status callback rejected — signature did not match for ${url}`);
    return new NextResponse("Bad signature", { status: 403 });
  }

  const form = new URLSearchParams(raw);
  const sid = form.get("MessageSid") ?? form.get("SmsSid") ?? "";
  const reported = (form.get("MessageStatus") ?? form.get("SmsStatus") ?? "").toLowerCase();
  if (!sid || !KNOWN.has(reported as SmsStatus)) {
    // "accepted", "sending" and "receiving" are steps on the way that say
    // nothing a human needs; acknowledged so Twilio stops retrying.
    return new NextResponse(null, { status: 204 });
  }
  const code = Number(form.get("ErrorCode") ?? "") || null;
  const message = form.get("ErrorMessage");
  await markSmsStatus(sid, reported as SmsStatus, code, message);
  return new NextResponse(null, { status: 204 });
}
