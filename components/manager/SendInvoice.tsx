"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Sending is always a deliberate press, never a side effect of anything else —
// and a second press asks first, because a customer getting the same invoice
// twice looks like chasing.
export default function SendInvoice({
  id,
  email,
  alreadySent,
  disabled,
}: {
  id: string;
  email: string;
  alreadySent: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function send() {
    if (alreadySent && !confirm(`Send this invoice to ${email} again?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/quotes/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error || "Could not send the invoice. Please try again.");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <span className="sub">Sent to {email}</span>;
  return (
    <>
      <button type="button" className="btn btn-outline" onClick={send} disabled={busy || disabled}>
        {busy ? "Sending…" : alreadySent ? "Send again" : "Send"}
      </button>
      {error && <div className="field-error">{error}</div>}
    </>
  );
}
