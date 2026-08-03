"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatePicker from "@/components/DatePicker";
import { addDaysISO, formatDateLong, formatTime, todayISO } from "@/lib/format";
import type { SlotBlock } from "@/lib/blocks";

type SlotInfo = { time: string; blocked: boolean; booked: boolean };
type RoomDay = { id: string; name: string; location: string; times: SlotInfo[] };

export default function BlocksManager({
  initialBlocks,
  roomNames,
}: {
  initialBlocks: SlotBlock[];
  roomNames: Record<string, string>;
}) {
  const router = useRouter();
  const [date, setDate] = useState(todayISO());
  const [rooms, setRooms] = useState<RoomDay[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()); // "roomId|time"
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearingDate, setClearingDate] = useState<string | null>(null);

  const loadDay = useCallback(async () => {
    setRooms(null);
    setPicked(new Set());
    try {
      const res = await fetch(`/api/manager/slots?date=${date}`);
      const data = await res.json();
      setRooms(data.rooms ?? []);
    } catch {
      setError("Could not load that day's sessions. Check your connection.");
      setRooms([]);
    }
  }, [date]);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  function toggle(key: string) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRoom(room: RoomDay) {
    const free = room.times.filter((t) => !t.blocked);
    const keys = free.map((t) => `${room.id}|${t.time}`);
    const allPicked = keys.length > 0 && keys.every((k) => picked.has(k));
    setPicked((p) => {
      const next = new Set(p);
      for (const k of keys) (allPicked ? next.delete(k) : next.add(k));
      return next;
    });
  }

  async function block() {
    if (picked.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    // Group the picked keys back into { roomId: times[] } and send one call per room.
    const byRoom = new Map<string, string[]>();
    for (const key of picked) {
      const [roomId, time] = key.split("|");
      byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), time]);
    }
    try {
      for (const [roomId, times] of byRoom) {
        const res = await fetch("/api/manager/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomIds: [roomId], date, times, reason }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not block those slots.");
      }
      setReason("");
      await loadDay();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not block those slots.");
    } finally {
      setBusy(false);
    }
  }

  async function unblockOne(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/manager/blocks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await loadDay();
      router.refresh();
    } catch {
      setError("Could not unblock that slot. Try again.");
    }
  }

  async function clearDay(d: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/blocks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: d }),
      });
      if (!res.ok) throw new Error();
      setClearingDate(null);
      await loadDay();
      router.refresh();
    } catch {
      setError("Could not clear that day. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Active blocks grouped by date for the list below.
  const byDate = new Map<string, SlotBlock[]>();
  for (const b of initialBlocks) byDate.set(b.date, [...(byDate.get(b.date) ?? []), b]);

  return (
    <>
      <div className="mgr-card">
        <h2>Block off sessions</h2>
        <p className="card-sub">
          Pick a date, then tap the sessions to take out of service. Already-blocked slots show in red — tap them in
          the list below to bring them back.
        </p>
        <div className="mgr-inline-form" style={{ marginBottom: 18 }}>
          <div className="field">
            <label>Date</label>
            {/* a year ahead — blocks can be set well beyond the booking window */}
            <DatePicker value={date} min={todayISO()} max={addDaysISO(todayISO(), 365)} onChange={setDate} />
          </div>
          <div className="field" style={{ minWidth: 260 }}>
            <label htmlFor="blk-reason">Reason (optional)</label>
            <input
              id="blk-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Maintenance, private event"
            />
          </div>
        </div>

        {rooms === null ? (
          <p className="mgr-empty">Loading sessions…</p>
        ) : rooms.length === 0 ? (
          <p className="mgr-empty">No sessions run on {formatDateLong(date)}.</p>
        ) : (
          <div className="blk-rooms">
            {rooms.map((room) => (
              <div className="blk-room" key={room.id}>
                <div className="blk-room-head">
                  <div>
                    <strong>{room.name}</strong>
                    <span className="sub"> · {room.location}</span>
                  </div>
                  <button type="button" className="link-button" onClick={() => toggleRoom(room)}>
                    Select all
                  </button>
                </div>
                <div className="blk-times">
                  {room.times.length === 0 && <span className="sub">No sessions this day</span>}
                  {room.times.map((t) => {
                    const key = `${room.id}|${t.time}`;
                    const cls = t.blocked ? "blk-time blocked" : picked.has(key) ? "blk-time picked" : "blk-time";
                    return (
                      <button
                        key={key}
                        type="button"
                        className={cls}
                        disabled={t.blocked}
                        title={t.blocked ? "Already blocked" : t.booked ? "Has bookings — blocking hides it from new customers" : undefined}
                        onClick={() => toggle(key)}
                      >
                        {formatTime(t.time)}
                        {t.booked && !t.blocked && <span className="blk-dot" aria-label="has bookings" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 18 }}>
          <button type="button" className="btn" onClick={block} disabled={busy || picked.size === 0}>
            {busy ? "Blocking…" : `Block ${picked.size || ""} session${picked.size === 1 ? "" : "s"}`.trim()}
          </button>
          {picked.size > 0 && (
            <button type="button" className="link-button" onClick={() => setPicked(new Set())}>
              Clear selection
            </button>
          )}
          {error && <span className="field-error">{error}</span>}
        </div>
      </div>

      <div className="mgr-card">
        <h2>Currently blocked</h2>
        {byDate.size === 0 ? (
          <p className="mgr-empty">Nothing is blocked — every session is bookable.</p>
        ) : (
          [...byDate.entries()].map(([d, list]) => (
            <div key={d} className="blk-day">
              <div className="blk-day-head">
                <strong>{formatDateLong(d)}</strong>
                <button type="button" className="link-button danger" onClick={() => setClearingDate(d)}>
                  Unblock whole day
                </button>
              </div>
              <ul className="mgr-notes">
                {list.map((b) => (
                  <li key={b.id}>
                    <div>
                      <div>
                        <strong>{formatTime(b.time)}</strong> · {roomNames[b.roomId] ?? b.roomId}
                      </div>
                      {b.reason && <div className="sub">{b.reason}</div>}
                    </div>
                    <button type="button" className="link-button" onClick={() => unblockOne(b.id)}>
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={clearingDate !== null}
        title="Unblock the whole day?"
        confirmLabel="Yes, unblock everything"
        busy={busy}
        onConfirm={() => clearingDate && clearDay(clearingDate)}
        onCancel={() => !busy && setClearingDate(null)}
      >
        <p>
          Every blocked session on <strong>{clearingDate ? formatDateLong(clearingDate) : ""}</strong> becomes
          bookable again immediately.
        </p>
      </ConfirmDialog>
    </>
  );
}
