"use client";

import TimeSelect from "./TimeSelect";
import { WEEKDAY_NAMES } from "@/lib/schedule";

export type DayRow = { start: string; end: string; closed: boolean };
export type WeekValue = Record<string, DayRow>;

const DEFAULT_ROW: DayRow = { start: "10:00", end: "20:00", closed: false };

// Per-weekday two-time editor (0 = Sunday). Used for booking windows
// (first/last start) and for store opening hours (open/close).
export default function WeekEditor({
  value,
  onChange,
  startLabel,
  endLabel,
}: {
  value: WeekValue;
  onChange: (v: WeekValue) => void;
  startLabel: string;
  endLabel: string;
}) {
  function setDay(dow: number, patch: Partial<DayRow>) {
    const cur = value[dow] ?? DEFAULT_ROW;
    onChange({ ...value, [dow]: { ...cur, ...patch } });
  }

  return (
    <div className="mgr-week">
      <div className="mgr-week-row mgr-week-head">
        <span className="day" />
        <span>{startLabel}</span>
        <span>{endLabel}</span>
        <span />
      </div>
      {WEEKDAY_NAMES.map((name, dow) => {
        const row = value[dow] ?? DEFAULT_ROW;
        return (
          <div className="mgr-week-row" key={dow}>
            <span className="day">{name}</span>
            <div style={row.closed ? { opacity: 0.4, pointerEvents: "none" } : undefined}>
              <TimeSelect ariaLabel={`${name} ${startLabel}`} value={row.start} onChange={(v) => setDay(dow, { start: v })} />
            </div>
            <div style={row.closed ? { opacity: 0.4, pointerEvents: "none" } : undefined}>
              <TimeSelect ariaLabel={`${name} ${endLabel}`} value={row.end} onChange={(v) => setDay(dow, { end: v })} />
            </div>
            <label className="mgr-week-closed">
              <input type="checkbox" checked={row.closed} onChange={(e) => setDay(dow, { closed: e.target.checked })} />
              Closed
            </label>
          </div>
        );
      })}
    </div>
  );
}
