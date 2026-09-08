"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DrawResult } from "@/lib/draw";

// The draw is deliberately one-way: before it runs this shows the pool filling
// up, after it runs it only ever shows the saved result. There is no re-draw
// button, because a prize draw you can re-roll isn't a prize draw.
export default function DrawBoard({
  result,
  csv,
  locations,
  entriesByLocation,
  totalEntries,
  canRun,
  open,
  drawDate,
  winnersPerLocation,
  ticketsPerWinner,
  cancelledIds,
}: {
  result: DrawResult | null;
  csv: string | null;
  locations: string[];
  entriesByLocation: Record<string, number>;
  totalEntries: number;
  canRun: boolean;
  open: boolean; // false until the draw date — the API enforces this too
  drawDate: string;
  winnersPerLocation: number;
  ticketsPerWinner: number;
  // Winners whose booking was cancelled after the draw — shown, not removed.
  cancelledIds: string[];
}) {
  const cancelled = new Set(cancelledIds);
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/draw", { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Could not run the draw.");
      setConfirming(false);
      router.refresh(); // the saved result comes back down from the server
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run the draw.");
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (!csv) return;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "premiere-draw-winners.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (result) {
    return (
      <>
        <div className="mgr-success">
          Drawn {new Date(result.drawnAt).toLocaleString("en-CA")} by {result.drawnBy} — {result.winners.length} winners
          from {result.entryCount} entries. This result is final.
        </div>
        <div className="mgr-actions-row" style={{ marginBottom: 16 }}>
          <button type="button" className="btn btn-outline" onClick={downloadCsv} disabled={!csv}>
            Download winners (CSV)
          </button>
        </div>
        {locations.map((location) => {
          const winners = result.winners.filter((w) => w.location === location);
          if (winners.length === 0) return null;
          return (
            <div className="form-card" key={location} style={{ marginBottom: 16 }}>
              <h3>
                {location} — {winners.length} winner{winners.length === 1 ? "" : "s"}
              </h3>
              <div className="mgr-table-wrap">
                <table className="mgr-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Booking</th>
                      <th>Tickets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {winners.map((w) => (
                      <tr key={`${w.bookingId}-${w.location}`}>
                        <td>{w.name || <em>No name on the booking</em>}</td>
                        <td>{w.email || <em>—</em>}</td>
                        <td>{w.phone || <em>—</em>}</td>
                        <td>
                          {w.reference}
                          {w.walkIn && " (desk)"}
                          {cancelled.has(w.bookingId) && <strong> — cancelled since the draw</strong>}
                        </td>
                        <td>{w.tickets}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {winners.some((w) => cancelled.has(w.bookingId)) && (
                <p className="mgr-page-sub">
                  A winner here cancelled their booking after the draw. The result stands as drawn — whether the
                  tickets still go to them, or to someone else, is your call.
                </p>
              )}
              {winners.some((w) => !w.email && !w.phone) && (
                <p className="mgr-page-sub">
                  A winner here has no contact details — it was taken at the desk. Look the booking reference up on the
                  Bookings tab to find them.
                </p>
              )}
            </div>
          );
        })}
      </>
    );
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-card" style={{ marginBottom: 16 }}>
        <h3>Entries so far — {totalEntries} total</h3>
        <div className="mgr-table-wrap">
          <table className="mgr-table">
            <thead>
              <tr>
                <th>Location</th>
                <th>Entries</th>
                <th>Winners to draw</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => {
                const count = entriesByLocation[location] ?? 0;
                return (
                  <tr key={location}>
                    <td>{location}</td>
                    <td>{count}</td>
                    <td>
                      {winnersPerLocation}
                      {count < winnersPerLocation && " — not enough entries yet"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!open ? (
        <p className="mgr-page-sub">
          Entries are still open. The draw unlocks on {drawDate}, once the last bookings are in.
        </p>
      ) : canRun ? (
        confirming ? (
          <div className="form-card">
            <h3>Run the draw?</h3>
            <p className="mgr-page-sub">
              This picks {winnersPerLocation} winners at each location, {ticketsPerWinner} tickets each, and saves the
              result permanently. It cannot be undone or drawn again.
            </p>
            <div className="mgr-actions-row">
              <button type="button" className="btn" onClick={run} disabled={busy}>
                {busy ? "Drawing…" : "Yes, draw the winners"}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirming(true)} disabled={totalEntries === 0}>
            Run the draw
          </button>
        )
      ) : (
        <p className="mgr-page-sub">Only an admin can run the draw.</p>
      )}
    </>
  );
}
