"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GameResult } from "@/lib/types";

// Post-game logging on the manager booking page: escaped?, time left, hints.
// Feeds the per-room analytics on Reports.
export default function GameResultForm({ bookingId, initial }: { bookingId: string; initial: GameResult | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(initial === null);
  const [escaped, setEscaped] = useState(initial?.escaped ?? true);
  const [timeRemaining, setTimeRemaining] = useState(initial?.timeRemainingMinutes?.toString() ?? "");
  const [hints, setHints] = useState(initial?.hintsUsed?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/bookings/${bookingId}/game`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          escaped,
          timeRemainingMinutes: timeRemaining.trim() === "" ? null : Number(timeRemaining),
          hintsUsed: hints.trim() === "" ? null : Number(hints),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save the result. Try again.");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the result. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing && initial) {
    return (
      <div className="cust-info">
        <h2>Game result</h2>
        <p>
          {initial.escaped ? "Escaped" : "Did not escape"}
          {initial.timeRemainingMinutes !== null && ` · ${initial.timeRemainingMinutes} min left`}
          {initial.hintsUsed !== null && ` · ${initial.hintsUsed} hint(s)`}
          {initial.notes && (
            <>
              <br />
              <span className="sub">{initial.notes}</span>
            </>
          )}
          <br />
          <button type="button" className="link-button" onClick={() => setEditing(true)}>
            Edit result
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="cust-info">
      <h2>Game result</h2>
      <div className="mgr-form">
        <label className="intg-toggle">
          <input type="checkbox" checked={escaped} onChange={(e) => setEscaped(e.target.checked)} />
          The group escaped
        </label>
        <div className="field">
          <label htmlFor="gr-time">Minutes left on the clock</label>
          <input
            id="gr-time"
            type="number"
            min="0"
            max="240"
            value={timeRemaining}
            onChange={(e) => setTimeRemaining(e.target.value)}
            placeholder="e.g. 7"
          />
        </div>
        <div className="field">
          <label htmlFor="gr-hints">Hints used</label>
          <input
            id="gr-hints"
            type="number"
            min="0"
            max="99"
            value={hints}
            onChange={(e) => setHints(e.target.value)}
            placeholder="e.g. 2"
          />
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" className="btn" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save result"}
          </button>
          {initial && (
            <button type="button" className="link-button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </div>
        {error && <p className="field-error">{error}</p>}
      </div>
    </div>
  );
}
