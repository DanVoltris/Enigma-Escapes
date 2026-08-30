"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatePicker from "@/components/DatePicker";
import SingleSelect from "@/components/SingleSelect";
import { addDaysISO, formatDateLong, formatMoney, formatTime, todayISO } from "@/lib/format";

type Room = { id: string; name: string; location: string };

// Sentinel value for the "Custom time…" entry in the start-time dropdown.
const CUSTOM = "__custom";
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export type Session = { roomName: string; roomId: string; date: string; time: string; quantity: number };

// Cancel or move a booking from the portal — the phone-call cases the
// customer's own self-service link deliberately can't cover.
//
// A booking can hold several sessions: a group taking two rooms buys them on one
// reference. Guest count and moves apply to ONE of them, chosen here and passed
// to the API as an index; cancelling still takes the whole booking, because
// that's what a booking is.
export default function BookingActions({
  bookingId,
  paidCents,
  stripeLive,
  sessions,
  rooms,
}: {
  bookingId: string;
  paidCents: number;
  stripeLive: boolean;
  sessions: Session[];
  rooms: Room[];
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<"none" | "cancel" | "move" | "party">("none");
  // Which session the party/move panels are acting on.
  const [target, setTarget] = useState(0);
  const current = sessions[target] ?? sessions[0];

  // Cancel
  const [refund, setRefund] = useState<"full" | "partial" | "none">("full");
  const [partial, setPartial] = useState((paidCents / 100).toFixed(2));
  const [notifyCancel, setNotifyCancel] = useState(true);
  const [confirming, setConfirming] = useState(false);

  // Party size
  const [guests, setGuests] = useState(String(current.quantity));

  // Move. The times offered come from the room's own schedule for the chosen
  // date, with what's already taken marked — a room runs different hours on a
  // Friday than a Sunday, and typing a time that doesn't exist only fails at
  // the point of saving.
  type Slot = { time: string; blocked: boolean; taken: number; remaining: number };
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [roomId, setRoomId] = useState(current.roomId);
  const [date, setDate] = useState(current.date);
  const [time, setTime] = useState(current.time);
  // The desk typed the start rather than picking it off the room's schedule —
  // the group that wants 12:45 when the room runs 12:15 and 13:30.
  const [customTime, setCustomTime] = useState(false);
  const [notifyMove, setNotifyMove] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Opening a panel seeds it from the session it will act on — otherwise the
  // second room's panel would come up showing the first room's time.
  function open(next: "cancel" | "move" | "party", index = 0) {
    const s = sessions[index] ?? sessions[0];
    setTarget(index);
    setGuests(String(s.quantity));
    setRoomId(s.roomId);
    setDate(s.date);
    setTime(s.time);
    setCustomTime(false);
    setError(null);
    setDone(null);
    setPanel(next);
  }

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
    // A typed time can be half-finished in a way a picked one can't.
    if (customTime && !TIME_RE.test(time)) {
      setError("Give the start time as HH:MM on a 24-hour clock, e.g. 12:45.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/bookings/${bookingId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, date, time, customTime, notify: notifyMove, itemIndex: target }),
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

  useEffect(() => {
    if (panel !== "move") return;
    let live = true;
    setSlots(null);
    fetch(`/api/manager/slots?date=${encodeURIComponent(date)}&ignore=${encodeURIComponent(bookingId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        const room = (d.rooms ?? []).find((r: { id: string }) => r.id === roomId);
        setSlots(room?.times ?? []);
      })
      .catch(() => live && setSlots([]));
    return () => {
      live = false;
    };
  }, [panel, roomId, date, bookingId]);

  async function changeParty() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/manager/bookings/${bookingId}/party`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: Number(guests), itemIndex: target }),
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
        <>
          {sessions.length === 1 ? (
            <div className="vch-save">
              <button type="button" className="btn btn-outline" onClick={() => open("party")}>
                Change guest count
              </button>
              <button type="button" className="btn btn-outline" onClick={() => open("move")}>
                Move to another session
              </button>
              <button type="button" className="btn btn-danger" onClick={() => open("cancel")}>
                Cancel booking
              </button>
            </div>
          ) : (
            <>
              {/* Several rooms on one booking, so each gets its own controls —
                  changing the guest count "on the booking" would be ambiguous. */}
              <ul className="cust-activity alert-list">
                {sessions.map((s, i) => (
                  <li key={`${s.roomId}-${s.date}-${s.time}`}>
                    <div className="body" style={{ width: "100%" }}>
                      <div>
                        <strong>{s.roomName}</strong> — {formatDateLong(s.date)}, {formatTime(s.time)}
                      </div>
                      <div className="when">
                        {s.quantity} guest{s.quantity === 1 ? "" : "s"}
                      </div>
                      <div className="vch-save" style={{ marginTop: 6 }}>
                        <button type="button" className="btn btn-outline" onClick={() => open("party", i)}>
                          Change guest count
                        </button>
                        <button type="button" className="btn btn-outline" onClick={() => open("move", i)}>
                          Move this session
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="card-sub">
                Cancelling takes the whole booking — every room on it — and refunds against the one
                payment. To drop a single room, move the others onto a new booking first.
              </p>
              <div className="vch-save">
                <button type="button" className="btn btn-danger" onClick={() => open("cancel")}>
                  Cancel booking
                </button>
              </div>
            </>
          )}
        </>
      )}

      {panel === "party" && (
        <>
          {sessions.length > 1 && (
            <p className="card-sub" style={{ marginTop: 4 }}>
              Changing <strong>{current.roomName}</strong> — {formatDateLong(current.date)},{" "}
              {formatTime(current.time)}.
            </p>
          )}
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
              disabled={busy || !guests.trim() || Number(guests) === current.quantity}
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
          {sessions.length > 1 && (
            <p className="card-sub" style={{ marginTop: 4 }}>
              Moving <strong>{current.roomName}</strong> — {formatDateLong(current.date)},{" "}
              {formatTime(current.time)}. The other rooms on this booking stay where they are.
            </p>
          )}
          <div className="vch-row">
            <div className="field">
              <label>Experience</label>
              <SingleSelect
                ariaLabel="Experience"
                value={roomId}
                onChange={setRoomId}
                options={rooms.map((r) => ({ value: r.id, label: `${r.name} — ${r.location}` }))}
              />
            </div>
            <div className="field">
              <label>Date</label>
              <DatePicker
                value={date}
                min={todayISO()}
                max={addDaysISO(todayISO(), 365)}
                onChange={setDate}
              />
            </div>
            <div className="field">
              <label>Start time</label>
              {customTime ? (
                <>
                  {/* Uncontrolled on purpose: Safari builds each two-digit
                      segment keystroke by keystroke, and a controlled re-render
                      between keystrokes resets that buffer (7:30 landed as
                      7:00). Mounts fresh when custom time is switched on. */}
                  <input
                    type="time"
                    defaultValue={time}
                    onChange={(e) => setTime(e.target.value)}
                    aria-label="Custom start time"
                  />
                  <p className="field-hint">
                    Off the grid — the room&apos;s own sessions either side of it stop being bookable
                    while this one runs.
                  </p>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setCustomTime(false);
                      setTime(slots?.[0]?.time ?? "");
                    }}
                  >
                    Pick from the list
                  </button>
                </>
              ) : slots === null ? (
                <p className="sub">Loading times…</p>
              ) : (
                <>
                  {slots.length === 0 && <p className="sub">That room doesn&apos;t run on this date.</p>}
                  <SingleSelect
                    ariaLabel="Start time"
                    value={time}
                    onChange={(v) => {
                      if (v === CUSTOM) {
                        setCustomTime(true);
                        setTime("");
                      } else {
                        setTime(v);
                      }
                    }}
                    options={[
                      ...slots.map((sl) => ({
                        value: sl.time,
                        label: sl.blocked
                          ? `${formatTime(sl.time)} — blocked off`
                          : sl.remaining <= 0
                            ? `${formatTime(sl.time)} — full`
                            : sl.taken > 0
                              ? `${formatTime(sl.time)} — ${sl.remaining} left`
                              : formatTime(sl.time),
                        disabled: sl.blocked || sl.remaining <= 0,
                      })),
                      { value: CUSTOM, label: "Custom time…" },
                    ]}
                  />
                </>
              )}
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
