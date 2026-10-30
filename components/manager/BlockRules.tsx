"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import DatePicker from "@/components/DatePicker";
import { addDaysISO, formatDateLong, formatTime, todayISO } from "@/lib/format";
import type { BlockRule } from "@/lib/blocks";

type Room = { id: string; name: string; location: string; week: Record<number, string[]> };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Monday first: "weekday mornings" is how a venue thinks about its week.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

// The same sessions out of service every week — "no Monday mornings until
// we've hired" — without blocking them a date at a time.
export default function BlockRules({
  rooms,
  rules,
  roomNames,
}: {
  rooms: Room[];
  rules: BlockRule[];
  roomNames: Record<string, string>;
}) {
  const router = useRouter();
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [from, setFrom] = useState(todayISO());
  const [openEnded, setOpenEnded] = useState(true);
  const [until, setUntil] = useState(addDaysISO(todayISO(), 28));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<BlockRule | null>(null);

  // Every time the chosen rooms run on the chosen days. A time only some of
  // them run is still offered; the server keeps each room's own.
  const offered = [
    ...new Set(rooms.filter((r) => roomIds.includes(r.id)).flatMap((r) => weekdays.flatMap((d) => r.week[d] ?? []))),
  ].sort();
  const picked = times.filter((t) => offered.includes(t));
  // Moving "From" past the end date drags the end date along.
  const untilDate = until < from ? from : until;

  const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/block-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomIds, weekdays, times: picked, from, until: openEnded ? null : untilDate, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save that repeating block.");
      setRoomIds([]);
      setWeekdays([]);
      setTimes([]);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that repeating block.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: BlockRule) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/block-rules/${rule.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setRemoving(null);
      router.refresh();
    } catch {
      setError("Could not remove that repeating block. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const ready = roomIds.length > 0 && weekdays.length > 0 && picked.length > 0 && reason.trim().length >= 3;
  const dayList = (days: number[]) => DAY_ORDER.filter((d) => days.includes(d)).map((d) => DAYS[d]).join(", ");

  return (
    <div className="mgr-card">
      <h2>Repeating blocks</h2>
      <p className="card-sub">
        Close the same sessions every week — until a date, or until you remove the block. Bookings already in those
        sessions stay; only new ones are stopped.
      </p>

      <div className="field">
        <label>Experiences</label>
        <div className="vch-days">
          {rooms.map((r) => (
            <label key={r.id} className="vch-check">
              <input type="checkbox" checked={roomIds.includes(r.id)} onChange={() => setRoomIds(flip(roomIds, r.id))} />
              {r.name}
              <span className="sub"> · {r.location}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Days</label>
        <div className="vch-days">
          {DAY_ORDER.map((d) => (
            <label key={d} className="vch-check">
              <input type="checkbox" checked={weekdays.includes(d)} onChange={() => setWeekdays(flip(weekdays, d))} />
              {DAYS[d]}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Times</label>
        {offered.length === 0 ? (
          <p className="sub">
            {roomIds.length === 0 || weekdays.length === 0
              ? "Pick experiences and days to see their times."
              : "Those experiences don't run on those days."}
          </p>
        ) : (
          <>
            <div className="blk-times">
              {offered.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={picked.includes(t) ? "blk-time picked" : "blk-time"}
                  onClick={() => setTimes(flip(times, t))}
                >
                  {formatTime(t)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="link-button"
              style={{ marginTop: 8 }}
              onClick={() => setTimes(picked.length === offered.length ? [] : offered)}
            >
              {picked.length === offered.length ? "Clear times" : "Select all"}
            </button>
          </>
        )}
      </div>

      <div className="mgr-inline-form" style={{ marginBottom: 18 }}>
        <div className="field">
          <label>From</label>
          <DatePicker value={from} min={todayISO()} max={addDaysISO(todayISO(), 365)} onChange={setFrom} />
        </div>
        <div className="field">
          <label>Until</label>
          <label className="vch-check">
            <input type="checkbox" checked={openEnded} onChange={() => setOpenEnded(!openEnded)} />
            Until further notice
          </label>
          {!openEnded && (
            <DatePicker value={untilDate} min={from} max={addDaysISO(todayISO(), 730)} onChange={setUntil} />
          )}
        </div>
        <div className="field" style={{ minWidth: 260 }}>
          <label htmlFor="rule-reason">Reason</label>
          <input
            id="rule-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Short-staffed until we hire"
            aria-required="true"
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button type="button" className="btn" onClick={save} disabled={busy || !ready}>
          {busy ? "Saving…" : "Block every week"}
        </button>
        {error && <span className="field-error">{error}</span>}
      </div>

      <h3 style={{ marginTop: 28 }}>In force</h3>
      {rules.length === 0 ? (
        <p className="mgr-empty">No repeating blocks.</p>
      ) : (
        <ul className="mgr-notes">
          {rules.map((r) => (
            <li key={r.id}>
              <div>
                <div>
                  <strong>{roomNames[r.roomId] ?? r.roomId}</strong> · {dayList(r.weekdays)} ·{" "}
                  {r.times.map(formatTime).join(", ")}
                </div>
                <div className="sub">
                  From {formatDateLong(r.from)} {r.until ? `to ${formatDateLong(r.until)}` : "until further notice"} ·{" "}
                  {r.reason}
                  {r.blockedBy ? ` · ${r.blockedBy}` : ""}
                </div>
              </div>
              <button type="button" className="link-button" onClick={() => setRemoving(r)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Remove this repeating block?"
        confirmLabel="Yes, put them back on sale"
        busy={busy}
        onConfirm={() => removing && remove(removing)}
        onCancel={() => !busy && setRemoving(null)}
      >
        <p>
          Every session it covers becomes bookable again immediately
          {removing ? ` — ${roomNames[removing.roomId] ?? removing.roomId}, ${removing.times.map(formatTime).join(", ")}` : ""}.
        </p>
      </ConfirmDialog>
    </div>
  );
}
