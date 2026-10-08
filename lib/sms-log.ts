// What happened to each text the app sent (table sms_messages, migration 0011).
//
// Nothing here may ever stop a text going out or break the page that sends it:
// a record of a message is worth less than the message. Every write is
// best-effort and every read falls back to "we don't know".
//
// Twilio reports delivery twice over: the POST that sends a message answers
// with "queued", and minutes later it calls /api/sms/status with what actually
// happened. Rows are matched on Twilio's own id (provider_sid) because that is
// all the callback carries.
import { rest } from "./supabase";

export type SmsKind =
  | "request_accepted"
  | "request_declined"
  | "request_confirmed"
  | "request_released"
  | "request_lapsed"
  | "reply_reminder"
  | "booking_confirmed"
  | "booking_rescheduled"
  | "booking_cancelled"
  | "reward_code"
  | "staff_alert"
  | "staff_notice";

// queued/sent are Twilio's word for "on its way"; delivered is the handset.
// undelivered and failed are the carrier and Twilio refusing respectively.
export type SmsStatus = "queued" | "sent" | "delivered" | "undelivered" | "failed";

export type SmsRecord = {
  id: string;
  phone: string;
  kind: SmsKind;
  about: string | null;
  status: SmsStatus;
  errorCode: number | null;
  errorText: string | null;
  createdAt: string;
  updatedAt: string;
};

const phoneKey = (phone: string): string => phone.replace(/\D/g, "").slice(-10);

type Row = {
  id: string;
  phone: string;
  kind: string;
  about: string | null;
  status: string;
  error_code: number | null;
  error_text: string | null;
  created_at: string;
  updated_at: string;
};

const toRecord = (r: Row): SmsRecord => ({
  id: r.id,
  phone: r.phone,
  kind: r.kind as SmsKind,
  about: r.about,
  status: r.status as SmsStatus,
  errorCode: r.error_code,
  errorText: r.error_text,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function recordSms(entry: {
  phone: string;
  kind: SmsKind;
  about?: string | null;
  status: SmsStatus;
  sid?: string | null;
  errorCode?: number | null;
  errorText?: string | null;
}): Promise<void> {
  try {
    await rest("sms_messages", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        phone: phoneKey(entry.phone),
        kind: entry.kind,
        about: entry.about ?? null,
        status: entry.status,
        provider_sid: entry.sid ?? null,
        error_code: entry.errorCode ?? null,
        error_text: entry.errorText ? entry.errorText.slice(0, 300) : null,
      }),
    });
  } catch (err) {
    console.error("could not record the text that was sent:", err);
  }
}

// The delivery callback. Twilio sends several per message (sent, then
// delivered), and they can arrive out of order on retries — so a message that
// has already reached the handset is never walked back to "sent".
const FINAL = new Set<SmsStatus>(["delivered", "undelivered", "failed"]);

export async function markSmsStatus(
  sid: string,
  status: SmsStatus,
  errorCode: number | null,
  errorText: string | null
): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (errorCode) patch.error_code = errorCode;
  if (errorText) patch.error_text = errorText.slice(0, 300);
  const notFinal = FINAL.has(status) ? "" : "&status=not.in.(delivered,undelivered,failed)";
  const res = await rest(`sms_messages?provider_sid=eq.${encodeURIComponent(sid)}${notFinal}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok && res.status !== 404) {
    console.error(`could not update the text ${sid}: ${res.status}`);
  }
}

// The newest text about each of these things (request ids, booking references),
// for showing on the screen staff are already looking at.
export async function lastSmsAbout(abouts: string[]): Promise<Map<string, SmsRecord>> {
  const keys = [...new Set(abouts.filter(Boolean))];
  if (keys.length === 0) return new Map();
  const list = keys.map((k) => `"${k.replace(/"/g, "")}"`).join(",");
  const out = new Map<string, SmsRecord>();
  try {
    const res = await rest(
      `sms_messages?about=in.(${list})&select=*&order=created_at.desc&limit=${Math.min(keys.length * 6, 600)}`
    );
    if (!res.ok) return out;
    for (const row of (await res.json()) as Row[]) {
      // Ordered newest first, so the first one seen for a thing is the one to keep.
      if (row.about && !out.has(row.about)) out.set(row.about, toRecord(row));
    }
  } catch (err) {
    console.error("could not read what happened to the texts:", err);
  }
  return out;
}

// Plain language for staff, who need to know what to do rather than what
// Twilio calls it. Twilio's codes: 21610 they replied STOP, 30003/30005 the
// handset is unreachable, 30007 a carrier filtered it as spam, 21614 it isn't
// a mobile.
export function smsOutcome(rec: SmsRecord | undefined): { text: string; bad: boolean } | null {
  if (!rec) return null;
  switch (rec.status) {
    case "delivered":
      return { text: "Text delivered", bad: false };
    case "queued":
    case "sent":
      return { text: "Text sent — no delivery confirmation yet", bad: false };
    case "undelivered":
    case "failed":
      return {
        text:
          rec.errorCode === 21610
            ? "Text refused — they replied STOP to us. Phone them."
            : rec.errorCode === 30007
              ? "Text blocked by their carrier as spam. Phone them."
              : rec.errorCode === 21614 || rec.errorCode === 30006
                ? "Text failed — that isn't a mobile number. Phone them."
                : `Text not delivered${rec.errorCode ? ` (${rec.errorCode})` : ""}. Phone them.`,
        bad: true,
      };
    default:
      return null;
  }
}
