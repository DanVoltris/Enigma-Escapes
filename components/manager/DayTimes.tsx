"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import SingleSelect from "@/components/SingleSelect";
import { addDaysISO, formatDateLong, formatTime, todayISO } from "@/lib/format";
import { minutesOfTime, minutesToTime } from "@/lib/capacity";

type Room = { id: string; name: string; location: string };
type Booked = { time: string; reference: string; guests: number; bookingId: string };
type Day = {
  date: string;
  roomName: string;
  durationMinutes: number;
  times: string[];
  normal: string[];
  booked: Booked[];
  custom: boolean;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Change what one room runs on one date, without touching that weekday.
//
// The list shown IS the day: adding a time opens a slot, removing one closes
// it. That's the shape a short-staffed day needs — the alternative, a list of
// additions, can never take a game away.
export default function DayTimes({
  rooms,
  initialDate,
  initialRoomId,
  viewingDate,
}: {
  rooms: Room[];
  initialDate?: string; // where the picker starts (the calendar's day)
  initialRoomId?: string;
  viewingDate?: string; // the day the grid above is showing, if any
}) {
  const router = useRouter();
  const today = todayISO();
  const [roomId, setRoomId] = useState(initialRoomId ?? rooms[0]?.id ?? "");
  const [date, setDate] = useState(initialDate ?? today);
  const [day, setDay] = useState<Day | null>(null);
  const [times, setTimes] = useState<string[]>([]);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!roomId || !date) return;
    setDay(null);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(
        `/api/manager/experiences/${encodeURIComponent(roomId)}/day-times?date=${encodeURIComponent(date)}`
      );
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not load that day.");
        return;
      }
      setDay(d as Day);
      setTimes((d as Day).times);
    } catch {
      setError("Could not load that day. Check your connection and try again.");
    }
  }, [roomId, date]);

  useEffect(() => {
    load();
  }, [load]);

  const bookedAt = (t: string) => (day?.booked ?? []).filter((b) => b.time === t);

  // Games that would run into each other. Allowed — a room can offer times a
  // group chooses between — but worth seeing, because only one of an
  // overlapping pair can ever be sold.
  const clashes = (() => {
    const d = day?.durationMinutes ?? 0;
    if (!d) return [];
    const out: { a: string; b: string; mins: number }[] = [];
    const sorted = [...times].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const over = minutesOfTime(sorted[i]) + d - minutesOfTime(sorted[j]);
        if (over > 0) out.push({ a: sorted[i], b: sorted[j], mins: over });
      }
    }
    return out;
  })();
  const dirty = day ? times.join() !== day.times.join() : false;

  function addTime() {
    const t = adding.trim();
    if (!TIME_RE.test(t)) {
      setError("Enter a start time as HH:MM on the 24-hour clock — 16:30 for 4:30 PM.");
      return;
    }
    if (times.includes(t)) {
      setError(`${formatTime(t)} is already on this day.`);
      return;
    }
    setError(null);
    setTimes([...times, t].sort());
    setAdding("");
  }

  async function save(clear = false) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/manager/experiences/${encodeURIComponent(roomId)}/day-times`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, times: clear ? null : times }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not save that.");
        return;
      }
      setDone(
        clear
          ? `${formatDateLong(date)} is back on the usual schedule.`
          : `${formatDateLong(date)} now runs ${d.times.map(formatTime).join(", ")}.`
      );
      await load();
      router.refresh();
    } catch {
      setError("Could not save that. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mgr-card">
      <h2>Times for one day</h2>
      <p className="card-sub">
        Change what a room runs on a single date — a group asking for a different hour, or a day short of
        staff. Every other week is untouched.
      </p>

      {/* Editing a different day from the one on screen is easy to do by
          accident once the date can be changed here, so it says so. */}
      {viewingDate && date !== viewingDate && (
        <p className="card-sub" style={{ color: "var(--danger)" }}>
          The grid above is showing {formatDateLong(viewingDate)} — you&apos;re editing{" "}
          {formatDateLong(date)}.
        </p>
      )}

      <div className="mgr-inline-form">
        {rooms.length > 1 && (
          <div className="field" style={{ minWidth: 240 }}>
            <label>Room</label>
            <SingleSelect
              ariaLabel="Room"
              value={roomId}
              onChange={setRoomId}
              options={rooms.map((r) => ({ value: r.id, label: `${r.name} — ${r.location}` }))}
            />
          </div>
        )}
        <div className="field">
          <label>Date</label>
          <DatePicker value={date} min={today} max={addDaysISO(today, 365)} onChange={setDate} />
        </div>
      </div>

      {error && <p className="field-error">{error}</p>}
      {done && <p className="mgr-pill on">{done}</p>}

      {!day ? (
        <p className="sub">Loading that day…</p>
      ) : (
        <>
          <p className="card-sub">
            {day.custom ? (
              <>
                <strong>{formatDateLong(day.date)} runs its own times.</strong> Normally it would be{" "}
                {day.normal.length ? day.normal.map(formatTime).join(", ") : "closed"}.
              </>
            ) : (
              <>{formatDateLong(day.date)} is on the usual schedule for that weekday.</>
            )}
          </p>

          <div className="daytimes">
            {times.length === 0 ? (
              <p className="cust-empty">No games this day.</p>
            ) : (
              times.map((t) => {
                const here = bookedAt(t);
                return (
                  <span key={t} className={`daytime${here.length ? " booked" : ""}`}>
                    <strong>{formatTime(t)}</strong>
                    {here.length > 0 ? (
                      // Booked slots can't be removed here — the server refuses
                      // it too, but saying so up front beats an error on save.
                      <span className="sub">
                        {here.reduce((s, b) => s + b.guests, 0)} booked · {here.map((b) => b.reference).join(", ")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="mgr-linklike danger"
                        onClick={() => setTimes(times.filter((x) => x !== t))}
                        aria-label={`Remove ${formatTime(t)}`}
                      >
                        Remove
                      </button>
                    )}
                  </span>
                );
              })
            )}
          </div>

          {clashes.length > 0 && (
            <div className="card-sub" style={{ color: "var(--danger)" }}>
              <strong>
                {clashes.length === 1 ? "Two of these games overlap" : "Some of these games overlap"} — only one
                of each pair can be sold.
              </strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {clashes.map((c) => (
                  <li key={`${c.a}-${c.b}`}>
                    {formatTime(c.a)} runs to {formatTime(minutesToTime(minutesOfTime(c.a) + (day.durationMinutes ?? 0)))} —
                    overlaps {formatTime(c.b)} by {c.mins} min
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mgr-inline-form" style={{ marginTop: 12 }}>
            <div className="field" style={{ maxWidth: 150 }}>
              <label htmlFor="dt-add">Add a start time</label>
              <input
                id="dt-add"
                type="time"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTime();
                  }
                }}
              />
            </div>
            <button type="button" className="btn btn-outline" onClick={addTime} disabled={busy}>
              Add
            </button>
          </div>

          <div className="vch-save" style={{ marginTop: 14 }}>
            <button type="button" className="btn" onClick={() => save(false)} disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save this day"}
            </button>
            {day.custom && (
              <button type="button" className="btn btn-outline" onClick={() => save(true)} disabled={busy}>
                Back to the usual schedule
              </button>
            )}
            {dirty && (
              <button type="button" className="btn btn-outline" onClick={() => setTimes(day.times)} disabled={busy}>
                Undo
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
