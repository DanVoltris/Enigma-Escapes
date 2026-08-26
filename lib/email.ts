// Server-only email via Resend's REST API with plain fetch (no SDK — same
// pattern as Twilio/Stripe/Supabase). Keys live in environment variables only:
//
//   RESEND_API_KEY   re_...   Resend dashboard -> API Keys
//   EMAIL_FROM       "Enigma Escapes <billing@enigmaescapes.com>"
//
// The from address must be on a domain verified in Resend, or every send is
// rejected. Without the variables `emailConfigured()` is false and the send
// buttons tell staff so rather than failing silently — unlike SMS, nobody
// clicks "send receipt" by accident, so a no-op would look like it worked.
const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM;

export function emailConfigured(): boolean {
  return Boolean(API_KEY && FROM);
}

export type EmailResult = { ok: true; id: string } | { ok: false; error: string };

// Deliberately returns a result rather than throwing: both callers are a staff
// member who pressed a button and is owed a plain answer either way.
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string | null;
}): Promise<EmailResult> {
  if (!emailConfigured()) {
    return { ok: false, error: "Email isn't set up yet — add RESEND_API_KEY and EMAIL_FROM." };
  }
  const to = opts.to.trim();
  if (!isEmail(to)) return { ok: false, error: `"${to}" doesn't look like an email address.` };

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.replyTo ? { reply_to: [opts.replyTo] } : {}),
      }),
    });
  } catch {
    return { ok: false, error: "Couldn't reach the email service. Check the connection and try again." };
  }

  if (!res.ok) {
    // Resend answers with {message} on failure; pass it on so staff see the
    // real reason (unverified domain, bad address) instead of a status code.
    const detail = await res
      .json()
      .then((b: { message?: string }) => b?.message)
      .catch(() => null);
    return { ok: false, error: detail || `Email service refused the send (${res.status}).` };
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, id: body.id || "" };
}

// Good enough to catch typing mistakes before we spend a send on them; real
// validity is only ever proven by delivery.
export function isEmail(value: string): boolean {
  const v = value.trim();
  return v.length > 3 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
