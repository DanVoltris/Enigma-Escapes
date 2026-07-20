"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WeekEditor, { type WeekValue } from "@/components/manager/WeekEditor";
import type { DayHours } from "@/lib/types";

const DEFAULT_WEEK: WeekValue = Object.fromEntries(
  Array.from({ length: 7 }, (_, d) => [String(d), { start: "10:00", end: "22:00", closed: false }])
);

function hoursToWeek(hours: Record<string, DayHours>): WeekValue {
  const w: WeekValue = { ...DEFAULT_WEEK };
  for (const [k, v] of Object.entries(hours)) w[k] = { start: v.open, end: v.close, closed: v.closed };
  return w;
}

function weekToHours(week: WeekValue): Record<string, DayHours> {
  const out: Record<string, DayHours> = {};
  for (const [k, v] of Object.entries(week)) out[k] = { open: v.start, close: v.end, closed: v.closed };
  return out;
}

export default function StoreHoursEditor({
  location,
  hours,
}: {
  location: string;
  hours: Record<string, DayHours>;
}) {
  const router = useRouter();
  const [week, setWeek] = useState<WeekValue>(hoursToWeek(hours));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/manager/hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, hours: weekToHours(week) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mgr-card">
      <h2>{location}</h2>
      <p className="card-sub">
        Games that “follow store hours” at this location run until closing time minus their length.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="mgr-success">Saved.</div>}
      <WeekEditor value={week} onChange={setWeek} startLabel="Opens" endLabel="Closes" />
      <div className="form-actions" style={{ marginTop: 16 }}>
        <button type="button" className="btn" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save hours"}
        </button>
      </div>
    </div>
  );
}
