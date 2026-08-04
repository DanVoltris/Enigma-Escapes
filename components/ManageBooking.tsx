"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatePicker from "@/components/DatePicker";
import { addDaysISO, formatDateLong, formatMoney, formatTime } from "@/lib/format";

type Slot = { time: string; remaining: number };

export default function ManageBooking({
  bookingId,
  roomId,
  roomName,
  quantity,
  singleSession,
  paidCents,
  today,
  windowDays,
  hoursAway,
  phone,
  textsEnabled,
  canReschedule,
}: {
  bookingId: string;
  roomId: string;
  roomName: string;
  quantity: number;
  singleSession: boolean;
  paidCents: number;
  today: string;
  windowDays: number;
  hoursAway: number;
  phone: string;
  textsEnabled: boolean;
  canReschedule: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "reschedule">("idle");
  // Default to the day after tomorrow — anything sooner fails the 24h rule.
  const [date, setDate] = useState(addDaysISO(today, 2));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "reschedule") return;
    setSlots(null);
    setPicked(null);
    fetch(`/api/availability?date=${date}`)
      .then((r) => r.json())
      .then((d) => {
        const mine = (d.slots ?? [])
          .filter((s: { roomId: string; remaining: number }) => s.roomId === roomId && s.remaining >= quantity)
          .map((s: { time: string; remaining: number }) => ({ time: s.time, remaining: s.remaining }));
        setSlots(mine);
      })
      .catch(() => setSlots([]));
  }, [mode, date, roomId, quantity]);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/booking/${bookingId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "That didn't work.");
      return data as Record<string, unknown>;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="manage-done">
        <h3>{done}</h3>
        <p>
          {textsEnabled
            ? "We’ve texted you a confirmation, and this page always shows your booking as it stands now."
            : "This page always shows your booking as it stands now."}{" "}
          {phone && <>Questions? Call {phone}.</>}
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="manage-note">
        You can change or cancel this booking yourself until 24 hours before your session
        {hoursAway > 0 && <> — that&apos;s about {hoursAway} hour{hoursAway === 1 ? "" : "s"} from now</>}.
      </p>

      {error && <div className="error-banner">{error}</div>}

      {mode === "idle" ? (
        <div className="manage-actions">
          {canReschedule && singleSession && (
            <button type="button" className="btn" onClick={() => setMode("reschedule")}>
              Reschedule
            </button>
          )}
          <button type="button" className="btn btn-outline manage-cancel" onClick={() => setConfirming(true)}>
            Cancel booking
          </button>
        </div>
      ) : (
        <div className="manage-reschedule">
          <h3>Pick a new time for {roomName}</h3>
          <div className="field" style={{ maxWidth: 260 }}>
            <label>New date</label>
            <DatePicker
              value={date}
              min={addDaysISO(today, 1)}
              max={addDaysISO(today, windowDays)}
              onChange={setDate}
            />
          </div>
          {slots === null ? (
            <p className="empty-state">Loading times…</p>
          ) : slots.length === 0 ? (
            <p className="empty-state">
              Nothing free for {quantity} guest{quantity === 1 ? "" : "s"} on {formatDateLong(date)} — try another day.
            </p>
          ) : (
            <div className="manage-slots">
              {slots.map((s) => (
                <button
                  key={s.time}
                  type="button"
                  className={`manage-slot${picked === s.time ? " picked" : ""}`}
                  onClick={() => setPicked(s.time)}
                >
                  {formatTime(s.time)}
                </button>
              ))}
            </div>
          )}
          <div className="manage-actions">
            <button
              type="button"
              className="btn"
              disabled={!picked || busy}
              onClick={async () => {
                const r = await send({ action: "reschedule", date, time: picked });
                if (r) {
                  setDone(`Moved to ${formatDateLong(date)} at ${formatTime(picked as string)}.`);
                  router.refresh();
                }
              }}
            >
              {busy ? "Moving…" : "Confirm new time"}
            </button>
            <button type="button" className="link-button" onClick={() => setMode("idle")}>
              Back
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title="Cancel this booking?"
        confirmLabel="Yes, cancel it"
        busy={busy}
        onConfirm={async () => {
          const r = await send({ action: "cancel" });
          if (r) {
            const refunded = Number(r.refundedCents ?? 0);
            const owed = Number(r.owedCents ?? 0);
            setConfirming(false);
            setDone(
              refunded > 0
                ? `Cancelled — ${formatMoney(refunded)} is on its way back to your card.`
                : owed > 0
                  ? `Cancelled — we'll be in touch about returning ${formatMoney(owed)}.`
                  : "Cancelled — nothing was charged."
            );
            router.refresh();
          }
        }}
        onCancel={() => !busy && setConfirming(false)}
      >
        <p>
          Your session will be released for someone else and this can&apos;t be undone.
          {paidCents > 0 && <> The {formatMoney(paidCents)} you&apos;ve paid will be returned to you.</>}
        </p>
      </ConfirmDialog>
    </>
  );
}
