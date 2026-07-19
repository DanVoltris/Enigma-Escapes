"use client";

import { usePopover } from "./usePopover";

export type SelectOption = { value: string; label: string };

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
};

// Custom dropdown so the control matches the site's design instead of the
// browser's native (OS-styled) <select> popup.
export default function SelectMenu({ value, options, onChange, ariaLabel }: Props) {
  const { ref, open, setOpen } = usePopover<HTMLDivElement>();
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className="selectmenu" ref={ref}>
      <button
        type="button"
        className="selectmenu-trigger"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span>{current?.label}</span>
        <span className="selectmenu-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <ul className="selectmenu-list" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                className={`selectmenu-option${o.value === value ? " selected" : ""}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
