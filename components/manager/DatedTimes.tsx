"use client";

import { useState } from "react";
import Link from "next/link";
import DatePicker from "@/components/DatePicker";
import TimesEditor from "@/components/manager/TimesEditor";
import { formatDateLong, formatTime, todayISO } from "@/lib/format";
import { periodsProblem } from "@/lib/time-periods";
import type { TimePeriod } from "@/lib/types";

// The room's usual times are permanent; these are for some dates — one day or a
// stretch, holiday hours, a group wanting a different hour — and end by
// themselves. One day inside a longer stretch wins there. Saved with the rest of
// the room; the Calendar's "Times for one day" writes to the same list.
export default function DatedTimes({
  value,
  onChange,
}: {
  value: TimePeriod[];
  onChange: (v: TimePeriod[]) => void;
}) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [times, setTimes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function open(i: number | "new") {
    const p = i === "new" ? null : value[i];
    setFrom(p?.from ?? "");
    setTo(p?.to ?? "");
    setTimes(p?.times ?? []);
    setError(null);
    setEditing(i);
  }

  function done() {
    if (!from || !to) return setError("Pick the first and last day.");
    if (to < from) return setError("The last day is before the first.");
    if (times.length === 0) return setError("Add at least one start time.");
    const others = value.filter((_, i) => i !== editing);
    const next = [...others, { from, to, times: [...times].sort() }].sort((a, b) =>
      a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? 1 : -1
    );
    const problem = periodsProblem(next);
    if (problem) return setError(problem);
    onChange(next);
    setEditing(null);
  }

  const today = todayISO();

  return (
    <div className="field">
      <label>Different times for some dates</label>
      <p className="field-hint" style={{ marginTop: 0 }}>
        For one day or a stretch of dates, run these times instead of the usual ones — a group wanting a different
        hour, holiday hours. Afterwards the room goes back to its usual times by itself. A single day inside a longer
        stretch wins on that day. To close sessions for a while instead, use{" "}
        <Link href="/manager/blocks">Blocked hours</Link>.
      </p>

      {value.length > 0 && (
        <ul className="mgr-notes" style={{ marginBottom: 12 }}>
          {value.map((p, i) => (
            <li key={`${p.from}-${p.to}`}>
              <div>
                <div>
                  <strong>
                    {p.from === p.to ? formatDateLong(p.from) : `${formatDateLong(p.from)} – ${formatDateLong(p.to)}`}
                  </strong>
                  {p.to < today && <span className="sub"> · ended</span>}
                </div>
                <div className="sub">{p.times.map(formatTime).join(", ")}</div>
              </div>
              <div style={{ display: "flex", gap: 14 }}>
                <button type="button" className="link-button" onClick={() => open(i)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="link-button danger"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing === null ? (
        <button type="button" className="btn btn-outline" onClick={() => open("new")}>
          + Add different times
        </button>
      ) : (
        <div style={{ border: "1px solid var(--border)", padding: 16 }}>
          <div className="field-row" style={{ maxWidth: 460 }}>
            <div className="field">
              <span className="field-hint">First day</span>
              {/* Last day follows the first until it's set: one day is the common case. */}
              <DatePicker value={from} min="" max="" onChange={(d) => { setFrom(d); if (!to || to < d) setTo(d); }} />
            </div>
            <div className="field">
              <span className="field-hint">Last day (same day for just one)</span>
              <DatePicker value={to} min={from} max="" onChange={setTo} />
            </div>
          </div>
          <TimesEditor value={times} onChange={setTimes} />
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14 }}>
            <button type="button" className="btn" onClick={done}>
              {editing === "new" ? "Add" : "Update"}
            </button>
            <button type="button" className="link-button" onClick={() => setEditing(null)}>
              Cancel
            </button>
            {error && <span className="field-error">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
