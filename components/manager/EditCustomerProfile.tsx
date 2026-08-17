"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Editing the customer themselves, from their profile. Changing the address
// moves the whole person — the stored record and every booking filed under it —
// so the page has to follow them to their new URL afterwards.
export default function EditCustomerProfile({
  email,
  firstName,
  lastName,
  phone,
  subscribe,
  bookings,
}: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  subscribe: boolean;
  bookings: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fn, setFn] = useState(firstName);
  const [ln, setLn] = useState(lastName);
  const [em, setEm] = useState(email);
  const [ph, setPh] = useState(phone);
  const [sub, setSub] = useState(subscribe);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/customers/${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: fn, lastName: ln, email: em, phone: ph, subscribe: sub }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not save that.");
        return;
      }
      setOpen(false);
      // The address is the profile's URL, so a change means a different page.
      if (d.email !== email) router.replace(`/manager/customers/${encodeURIComponent(d.email)}`);
      router.refresh();
    } catch {
      setError("Could not save that. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="mgr-linklike" onClick={() => setOpen(true)}>
        Edit customer
      </button>
    );
  }

  const movingAddress = em.trim().toLowerCase() !== email;

  return (
    <div style={{ marginTop: 10 }}>
      {error && <p className="field-error">{error}</p>}
      <div className="field">
        <label htmlFor="cp-fn">First name</label>
        <input id="cp-fn" type="text" value={fn} onChange={(e) => setFn(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cp-ln">Last name</label>
        <input id="cp-ln" type="text" value={ln} onChange={(e) => setLn(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cp-em">Email</label>
        <input id="cp-em" type="email" value={em} onChange={(e) => setEm(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cp-ph">Phone</label>
        <input id="cp-ph" type="tel" value={ph} onChange={(e) => setPh(e.target.value)} />
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={sub} onChange={(e) => setSub(e.target.checked)} />
        <span>Subscribed to marketing emails</span>
      </label>

      <p className="card-sub">
        {movingAddress ? (
          <>
            Their address is their identity here, so this moves the whole customer —{" "}
            <strong>
              {bookings} booking{bookings === 1 ? "" : "s"}
            </strong>{" "}
            and their stored details — onto {em.trim().toLowerCase() || "the new address"}.
          </>
        ) : (
          <>
            Applies to this customer and all {bookings} of their booking{bookings === 1 ? "" : "s"}. Nothing is
            resent.
          </>
        )}
      </p>

      <div className="vch-save">
        <button type="button" className="btn" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save customer"}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
