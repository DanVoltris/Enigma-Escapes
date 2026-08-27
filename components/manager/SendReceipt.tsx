"use client";

import { useState } from "react";
import { usePopover } from "@/components/usePopover";

// The receipt goes out only when someone presses this. Nothing in checkout,
// nothing in the Stripe webhook, nothing on a schedule sends one — a customer
// who didn't ask never gets email from us.
//
// It sits at the end of the booking's tab row, so a popover rather than an
// expanding block: the panel drops below the button instead of shoving the
// tabs around every time it opens.
export default function SendReceipt({
  bookingId,
  defaultEmail,
  ready,
}: {
  bookingId: string;
  defaultEmail: string;
  ready: boolean;
}) {
  const { ref, open, setOpen } = usePopover<HTMLDivElement>();
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

  return (
    <div className="receipt-send" ref={ref}>
      <button
        type="button"
        className="cust-tab receipt-trigger"
        onClick={() => setOpen(!open)}
        disabled={!ready}
        title={ready ? undefined : "Email isn't set up yet — add RESEND_API_KEY and EMAIL_FROM."}
      >
        {sentTo ? "Receipt sent ✓" : "Email receipt"}
      </button>

      {open && (
        <div className="receipt-panel">
          <div className="field">
            <label htmlFor="receipt-to">Send receipt to</label>
            <input
              type="email"
              id="receipt-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="name@example.com"
            />
            <p className="field-hint">Defaults to the address on the booking. Change it to send elsewhere.</p>
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="receipt-actions">
            <button type="button" className="btn" onClick={send} disabled={busy || !to.trim()}>
              {busy ? "Sending…" : "Send receipt"}
            </button>
            <button type="button" className="link-button" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
