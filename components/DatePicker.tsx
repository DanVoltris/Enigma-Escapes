"use client";

import { useState } from "react";
import { formatDateLong, parseISODate } from "@/lib/format";
import { usePopover } from "./usePopover";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

type Props = {
  value: string; // YYYY-MM-DD
  min: string; // YYYY-MM-DD (inclusive)
  max: string; // YYYY-MM-DD (inclusive)
  onChange: (date: string) => void;
};

// Custom calendar so the date field matches the site's design instead of the
// browser's native (OS-styled) date picker.
export default function DatePicker({ value, min, max, onChange }: Props) {
  const { ref, open, setOpen } = usePopover<HTMLDivElement>();
  const selected = parseISODate(value);
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth()); // 0-indexed

  const todayISOStr = new Intl.DateTimeFormat("en-CA").format(new Date());
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const viewKey = `${viewYear}-${pad(viewMonth + 1)}`;
  const canPrev = viewKey > min.slice(0, 7);
  const canNext = viewKey < max.slice(0, 7);

  function openCalendar() {
    // Jump the view to the currently selected month each time it opens.
    setViewYear(selected.getFullYear());
    setViewMonth(selected.getMonth());
    setOpen(true);
  }

  function shiftMonth(delta: number) {
    const m = viewMonth + delta;
    const y = viewYear + Math.floor(m / 12);
    const nm = ((m % 12) + 12) % 12;
    setViewYear(y);
    setViewMonth(nm);
  }

  function pick(day: number) {
    onChange(iso(viewYear, viewMonth, day));
    setOpen(false);
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="datepicker" ref={ref}>
      <button
        type="button"
        className="datepicker-trigger"
        onClick={() => (open ? setOpen(false) : openCalendar())}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="16" y1="2" x2="16" y2="6" />
        </svg>
        <span>{formatDateLong(value)}</span>
      </button>

      {open && (
        <div className="calendar" role="dialog" aria-label="Choose a date">
          <div className="calendar-header">
            <button
              type="button"
              className="calendar-nav"
              onClick={() => shiftMonth(-1)}
              disabled={!canPrev}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="calendar-title">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              className="calendar-nav"
              onClick={() => shiftMonth(1)}
              disabled={!canNext}
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <div className="calendar-grid calendar-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w} className="calendar-weekday">
                {w}
              </span>
            ))}
          </div>

          <div className="calendar-grid">
            {cells.map((day, i) => {
              if (day === null) return <span key={`b${i}`} className="calendar-cell empty" />;
              const dayISO = iso(viewYear, viewMonth, day);
              const disabled = dayISO < min || dayISO > max;
              const isSelected = dayISO === value;
              const isToday = dayISO === todayISOStr;
              return (
                <button
                  key={dayISO}
                  type="button"
                  className={`calendar-cell${isSelected ? " selected" : ""}${isToday ? " today" : ""}`}
                  onClick={() => pick(day)}
                  disabled={disabled}
                  aria-pressed={isSelected}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
