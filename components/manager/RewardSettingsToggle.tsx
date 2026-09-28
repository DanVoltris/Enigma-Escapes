"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Who gets a next-visit code. Either every booking earns the standard 20%, or
// only bookings made with a promo code that grants one — the hotel deal, where
// the offer is the reason the guest used the code in the first place.
export default function RewardSettingsToggle({ everyBooking }: { everyBooking: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(everyBooking);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: boolean) {
    setBusy(true);
    setError(null);
    const before = on;
    setOn(next);
    try {
      const res = await fetch("/api/manager/settings/rewards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ everyBooking: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not save that.");
      }
      router.refresh();
    } catch (err) {
      setOn(before); // put the switch back where it was rather than lie about it
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mgr-card">
      <label className="intg-toggle">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => save(e.target.checked)} />
        Text every customer a 20% code for their next visit
      </label>
      <p className="field-hint">
        {on
          ? "Every booking earns one, spendable on a later session before the visit that earned it starts."
          : "Only bookings made with a promo code that grants a follow-up code get one — set that up per code above."}
      </p>
      <p className="field-hint">
        A code a promo code grants keeps its own terms either way: its own discount, its own expiry, and
        whether it works on one game or every game until then.
      </p>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
