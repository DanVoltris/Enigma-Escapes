"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatMoney } from "@/lib/format";

type Room = { id: string; name: string; location: string };

// Cancel or move a booking from the portal — the phone-call cases the
// customer's own self-service link deliberately can't cover.
export default function BookingActions({
  bookingId,
  paidCents,
  stripeLive,
  currentRoomId,
  currentDate,
  currentTime,
  currentQuantity,
  rooms,
}: {
  bookingId: string;
  paidCents: number;
  stripeLive: boolean;
  currentRoomId: string;
  currentDate: string;
  currentTime: string;
  currentQuantity: number;
  rooms: Room[];
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<"none" | "cancel" | "move" | "party">("none");

  // Cancel
  const [refund, setRefund] = useState<"full" | "partial" | "none">("full");
  const [partial, setPartial] = useState((paidCents / 100).toFixed(2));
  const [notifyCancel, setNotifyCancel] = useState(true);
  const [confirming, setConfirming] = useState(false);

  // Party size
  const [guests, setGuests] = useState(String(currentQuantity));

  // Move
  const [roomId, setRoomId] = useState(currentRoomId);
  const [date, setDate] = useState(currentDate);
  const [time, setTime] = useState(currentTime);
  const [notifyMove, setNotifyMove] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refundCents =
    refund === "full" ? paidCents : refund === "partial" ? Math.round(Number(partial) * 100) || 0 : 0;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/bookings/${bookingId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refund, amount: Number(partial), notify: notifyCancel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not cancel that booking.");
      const d = data as { refundedCents: number; owedCents: number; rewardNote?: string | null };
      const base =
        d.refundedCents > 0
          ? `Cancelled — ${formatMoney(d.refundedCents)} refunded.`
          : d.owedCents > 0
            ? `Cancelled — ${formatMoney(d.owedCents)} still to refund by hand.`
            : "Cancelled — no refund given.";
      // A cancellation can also void a 20% reward and put another booking back
      // to full price; say so here, where staff are already looking.
      setDone(d.rewardNote ? `${base} ${d.rewardNote}` : base);
      setPanel("none");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel that booking.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  async function move() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/bookings/${bookingId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, date, time, notify: notifyMove }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not move that booking.");
      setDone("Booking moved.");
      setPanel("none");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move that booking.");
    } finally {
      setBusy(false);
    }
  }

  async function changeParty() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/manager/bookings/${bookingId}/party`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: Number(guests) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Could not change the party size.");
        return;
      }
      setDone(
        d.balanceCents > 0
          ? `Now ${d.quantity} guests — ${formatMoney(d.balanceCents)} still to collect.`
          : d.balanceCents < 0
            ? `Now ${d.quantity} guests — ${formatMoney(-d.balanceCents)} to refund.`
            : `Now ${d.quantity} guests — nothing further owed.`
      );
      setPanel("none");
      router.refresh();
    } catch {
      setError("Could not change the party size. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mgr-card">
      <h2>Change this booking</h2>
      <p className="card-sub">
        For the cases the customer&apos;s own link doesn&apos;t cover — a group that turns up a different size, a
        swap to another room, a date change, a late cancellation.
      </p>

      {done && <p className="mgr-pill on">{done}</p>}
      {error && <p className="field-error">{error}</p>}

      {panel === "none" && (
        <div className="vch-save">
          <button type="button" className="btn btn-outline" onClick={() => setPanel("party")}>
            Change guest count
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setPanel("move")}>
            Move to another session
          </button>
          <button type="button" className="btn btn-danger" onClick={() => setPanel("cancel")}>
            Cancel booking
          </button>
        </div>
      )}

      {panel === "party" && (
        <>
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="ba-guests">Guests playing</label>
            <input
              id="ba-guests"
              type="number"
              min="1"
              max="99"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          </div>
          <p className="card-sub">
            The total is re-figured at the price this booking was sold at, keeping any discount. What they have
            already paid stays put — the balance moves.
          </p>
          <div className="vch-save">
            <button
              type="button"
              className="btn"
              onClick={changeParty}
              disabled={busy || !guests.trim() || Number(guests) === currentQuantity}
            >
              {busy ? "Saving…" : "Save guest count"}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setPanel("none")}>
              Cancel
            </button>
          </div>
        </>
      )}

      {panel === "move" && (
        <>
          <div className="vch-row">
            <div className="field">
              <label htmlFor="ba-room">Experience</label>
              <select id="ba-room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.location}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ba-date">Date</label>
              <input id="ba-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ba-time">Start time</label>
              <input id="ba-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <label className="intg-toggle">
            <input type="checkbox" checked={notifyMove} onChange={(e) => setNotifyMove(e.target.checked)} />
            Text the customer their new time
          </label>
          <div className="vch-save">
            <button type="button" className="btn" onClick={move} disabled={busy}>
              {busy ? "Moving…" : "Move booking"}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setPanel("none")}>
              Cancel
            </button>
          </div>
        </>
      )}

      {panel === "cancel" && (
        <>
          <p className="card-sub" style={{ marginTop: 4 }}>
            They paid <strong>{formatMoney(paidCents)}</strong>.
            {!stripeLive && paidCents > 0 && " Card payments aren't live yet, so any refund is recorded for you to settle by hand."}
          </p>
          <div className="field">
            <label>Refund</label>
            <div className="vch-days">
              {(["full", "partial", "none"] as const).map((r) => (
                <label key={r} className="vch-check">
                  <input type="radio" name="refund" checked={refund === r} onChange={() => setRefund(r)} />
                  {r === "full" ? `Refund in full (${formatMoney(paidCents)})` : r === "partial" ? "Refund part" : "No refund"}
                </label>
              ))}
            </div>
          </div>
          {refund === "partial" && (
            <div className="field" style={{ maxWidth: 160 }}>
              <label htmlFor="ba-amount">Amount ($)</label>
              <input
                id="ba-amount"
                type="number"
                min="0"
                step="0.01"
                max={(paidCents / 100).toFixed(2)}
                value={partial}
                onChange={(e) => setPartial(e.target.value)}
              />
            </div>
          )}
          <label className="intg-toggle">
            <input type="checkbox" checked={notifyCancel} onChange={(e) => setNotifyCancel(e.target.checked)} />
            Text the customer to confirm the cancellation
          </label>
          <div className="vch-save">
            <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)} disabled={busy}>
              Cancel booking
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setPanel("none")}>
              Back
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirming}
        title="Cancel this booking?"
        confirmLabel="Cancel booking"
        busy={busy}
        onConfirm={cancel}
        onCancel={() => setConfirming(false)}
      >
        <p>
          The slot is freed straight away and this can&apos;t be undone.{" "}
          {refundCents > 0
            ? `${formatMoney(refundCents)} goes back to the customer${stripeLive ? " automatically." : ", recorded for you to settle by hand."}`
            : "No money goes back."}
        </p>
      </ConfirmDialog>
    </div>
  );
}
