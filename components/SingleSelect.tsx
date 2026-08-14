"use client";

import { usePopover } from "./usePopover";

export type Opt = { value: string; label: string; disabled?: boolean };

// Custom single-select so the control matches the site design instead of the
// browser's native (OS-styled) <select> popup.
export default function SingleSelect({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const { ref, open, setOpen } = usePopover<HTMLDivElement>();
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className="selectmenu" ref={ref}>
      <button
        type="button"
        className="selectmenu-trigger"
        style={{ textTransform: "none", width: "100%" }}
        onClick={() => setOpen(!open)}
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
        <ul className="selectmenu-list" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value} aria-disabled={o.disabled}>
              <button
                type="button"
                className={`selectmenu-option${o.disabled ? " is-disabled" : ""}`}
                disabled={o.disabled}
                onClick={() => {
                  if (o.disabled) return;
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span className={`selectmenu-check${o.value === value ? " on" : ""}`} aria-hidden="true" />
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
