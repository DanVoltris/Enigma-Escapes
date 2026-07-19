"use client";

import { usePopover } from "./usePopover";

export type SelectOption = { value: string; label: string };
// A non-selectable section header, e.g. "Locations" / "Experiences".
export type SelectHeading = { heading: string };
export type SelectItem = SelectOption | SelectHeading;

function isHeading(item: SelectItem): item is SelectHeading {
  return "heading" in item;
}

type Props = {
  value: string;
  items: SelectItem[];
  onChange: (value: string) => void;
  ariaLabel: string;
};

// Custom dropdown so the control matches the site's design instead of the
// browser's native (OS-styled) <select> popup. Supports section headings.
export default function SelectMenu({ value, items, onChange, ariaLabel }: Props) {
  const { ref, open, setOpen } = usePopover<HTMLDivElement>();
  const options = items.filter((i): i is SelectOption => !isHeading(i));
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
          {items.map((item, i) =>
            isHeading(item) ? (
              <li key={`h${i}`} className="selectmenu-heading" role="presentation">
                {item.heading}
              </li>
            ) : (
              <li key={item.value} role="option" aria-selected={item.value === value}>
                <button
                  type="button"
                  className={`selectmenu-option${item.value === value ? " selected" : ""}`}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
