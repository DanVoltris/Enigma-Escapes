"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Loaded = {
  customer: { firstName: string; lastName: string; email: string; phone: string };
  otherBookings: number;
};

// Correcting who a booking belongs to — the mistyped address the confirmation
// never reached, the phone number that changed. Opened on demand: most visits to
// a booking aren't this.
export default function EditCustomer({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [alsoOthers, setAlsoOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    setOpen(true);
    setError(null);
    setDone(null);
    setData(null);
    try {
      const res = await fetch(`/api/manager/bookings/${bookingId}/customer`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not load the contact details.");
        return;
      }
      const loaded = d as Loaded;
      setData(loaded);
      setFirstName(loaded.customer.firstName);
      setLastName(loaded.customer.lastName);
      setEmail(loaded.customer.email);
      setPhone(loaded.customer.phone);
      setAlsoOthers(false);
    } catch {
      setError("Could not load the contact details. Check your connection and try again.");
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/manager/bookings/${bookingId}/customer`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, phone, alsoOthers }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not save that.");
        return;
      }
      setDone(
        d.changed > 1 ? `Updated on ${d.changed} bookings.` : d.note ?? "Contact details updated."
      );
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not save that. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <>
        {done && <p className="mgr-pill on">{done}</p>}
        <button type="button" className="mgr-linklike" onClick={load}>
          Edit contact details
        </button>
      </>
    );
  }

  const emailChanged = data ? email.trim().toLowerCase() !== data.customer.email : false;

  return (
    <div style={{ marginTop: 10 }}>
      {error && <p className="field-error">{error}</p>}
      {!data ? (
        <p className="sub">Loading…</p>
      ) : (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor="ec-fn">First name</label>
              <input id="ec-fn" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ec-ln">Last name</label>
              <input id="ec-ln" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ec-em">Email</label>
            <input id="ec-em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ec-ph">Phone</label>
            <input id="ec-ph" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>

          {/* The email is the customer's identity here, so changing it on one
              booking alone leaves the others filed under the old address — which
              is how one person becomes two profiles. */}
          {data.otherBookings > 0 && (
            <label className="checkbox-row">
              <input type="checkbox" checked={alsoOthers} onChange={(e) => setAlsoOthers(e.target.checked)} />
              <span>
                Apply to their other {data.otherBookings} booking{data.otherBookings === 1 ? "" : "s"}
                {emailChanged && " — otherwise those stay under the old address"}
              </span>
            </label>
          )}

          <p className="card-sub">
            This changes where their confirmation and any texts go. It doesn&apos;t resend anything.
          </p>

          <div className="vch-save">
            <button type="button" className="btn" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save contact details"}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
