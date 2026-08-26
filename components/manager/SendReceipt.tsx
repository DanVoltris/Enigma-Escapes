"use client";

import { useState } from "react";

// The receipt goes out only when someone presses this. Nothing in checkout,
// nothing in the Stripe webhook, nothing on a schedule sends one — a customer
// who didn't ask never gets email from us.
export default function SendReceipt({
  bookingId,
  defaultEmail,
  ready,
}: {
  bookingId: string;
  defaultEmail: string;
  ready: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/bookings/${bookingId}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: to.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; to?: string };
      if (!res.ok) {
        setError(body.error || "Could not send the receipt. Please try again.");
        return;
      }
      setSentTo(body.to || to.trim());
      setOpen(false);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <p className="sub" style={{ marginTop: 12 }}>
        Receipt emailed to {sentTo}.{" "}
        <button type="button" className="link-button" onClick={() => setSentTo(null)}>
          Send another
        </button>
      </p>
    );
  }

  if (!open) {
    return (
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(true)} disabled={!ready}>
          Email receipt
        </button>
        {!ready && (
          <p className="field-hint" style={{ marginTop: 6 }}>
            Email isn&apos;t set up yet — add RESEND_API_KEY and EMAIL_FROM to switch this on.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="field">
        <label htmlFor="receipt-to">Send receipt to</label>
        <input
          id="receipt-to"
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="name@example.com"
        />
        <p className="field-hint">Defaults to the address on the booking. Change it to send elsewhere.</p>
      </div>
      {error && <p className="field-error">{error}</p>}
      <div className="mgr-actions-row" style={{ marginTop: 8 }}>
        <button type="button" className="btn" onClick={send} disabled={busy || !to.trim()}>
          {busy ? "Sending…" : "Send receipt"}
        </button>
        <button type="button" className="link-button" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
