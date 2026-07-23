"use client";

import { useMemo, useState } from "react";
import { usePopover } from "./usePopover";

export type Opt = { value: string; label: string };

// Searchable single-select for long lists (timezones, currencies). Type to
// filter; matches the site's SingleSelect styling instead of a native <select>.
export default function Combobox({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Type to search…",
}: {
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const { ref, open, setOpen } = usePopover<HTMLDivElement>();
  const [q, setQ] = useState("");
  const current = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? options.filter((o) => o.label.toLowerCase().includes(s) || o.value.toLowerCase().includes(s))
      : options;
    return list.slice(0, 200); // cap the DOM; searching narrows it
  }, [q, options]);

  return (
    <div className="selectmenu" ref={ref}>
      <button
        type="button"
        className="selectmenu-trigger"
        style={{ textTransform: "none", width: "100%" }}
        onClick={() => {
          setQ("");
          setOpen(!open);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span>{current?.label ?? "Select…"}</span>
        <span className="selectmenu-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="selectmenu-list combobox-list" role="listbox" aria-label={ariaLabel}>
          <input
            type="text"
            className="combobox-search"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            aria-label={`${ariaLabel} — search`}
          />
          <ul className="combobox-scroll">
            {filtered.length === 0 ? (
              <li className="combobox-empty">No matches</li>
            ) : (
              filtered.map((o) => (
                <li key={o.value} role="option" aria-selected={o.value === value}>
                  <button
                    type="button"
                    className="selectmenu-option"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    <span className={`selectmenu-check${o.value === value ? " on" : ""}`} aria-hidden="true" />
                    {o.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
