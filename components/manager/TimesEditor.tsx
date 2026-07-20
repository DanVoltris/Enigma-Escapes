"use client";

import { useState } from "react";
import SingleSelect from "@/components/SingleSelect";
import { formatTime } from "@/lib/format";

function hourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourLabel(h) }));
const MINUTES = ["00", "15", "30", "45"].map((m) => ({ value: m, label: `:${m}` }));

// Build the daily start-time list without typing — pick an hour and minute and
// add it; each added time is a removable chip. Stores 24h "HH:MM" strings.
export default function TimesEditor({ value, onChange }: { value: string[]; onChange: (t: string[]) => void }) {
  const [hour, setHour] = useState("19");
  const [minute, setMinute] = useState("00");

  function add() {
    const t = `${hour.padStart(2, "0")}:${minute}`;
    if (!value.includes(t)) onChange([...value, t].sort());
  }

  return (
    <div>
      <div className="mgr-times-add">
        <SingleSelect ariaLabel="Hour" value={hour} onChange={setHour} options={HOURS} />
        <SingleSelect ariaLabel="Minute" value={minute} onChange={setMinute} options={MINUTES} />
        <button type="button" className="btn btn-outline" onClick={add}>
          + Add time
        </button>
      </div>

      {value.length === 0 ? (
        <p className="mgr-times-empty">No start times yet — add at least one above.</p>
      ) : (
        <div className="mgr-times-chips">
          {value.map((t) => (
            <span key={t} className="mgr-time-chip">
              {formatTime(t)}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${formatTime(t)}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
