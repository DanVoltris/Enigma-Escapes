"use client";

import { usePopover } from "./usePopover";

export type FilterOption = { value: string; label: string };
// A non-selectable section header, e.g. "Locations" / "Experiences".
export type FilterHeading = { heading: string };
export type FilterItem = FilterOption | FilterHeading;

function isHeading(item: FilterItem): item is FilterHeading {
  return "heading" in item;
}

type Props = {
  items: FilterItem[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  ariaLabel: string;
  allLabel: string; // shown as the "clear" row and as the trigger when nothing is selected
};

// Multi-select dropdown: check any number of options across categories. Stays
// open while selecting. Matches the site design instead of a native <select>.
export default function FilterMenu({ items, selected, onToggle, onClear, ariaLabel, allLabel }: Props) {
  const { ref, open, setOpen } = usePopover<HTMLDivElement>();
  const options = items.filter((i): i is FilterOption => !isHeading(i));

  let triggerLabel = allLabel;
  if (selected.length === 1) {
    triggerLabel = options.find((o) => o.value === selected[0])?.label ?? allLabel;
  } else if (selected.length > 1) {
    triggerLabel = `${selected.length} filters selected`;
  }

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
        <span>{triggerLabel}</span>
        <span className="selectmenu-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <ul className="selectmenu-list" role="listbox" aria-multiselectable="true" aria-label={ariaLabel}>
          <li role="option" aria-selected={selected.length === 0}>
            <button type="button" className="selectmenu-option" onClick={onClear}>
              <span className={`selectmenu-check${selected.length === 0 ? " on" : ""}`} aria-hidden="true" />
              {allLabel}
            </button>
          </li>
          {items.map((item, i) =>
            isHeading(item) ? (
              <li key={`h${i}`} className="selectmenu-heading" role="presentation">
                {item.heading}
              </li>
            ) : (
              <li key={item.value} role="option" aria-selected={selected.includes(item.value)}>
                <button type="button" className="selectmenu-option" onClick={() => onToggle(item.value)}>
                  <span
                    className={`selectmenu-check${selected.includes(item.value) ? " on" : ""}`}
                    aria-hidden="true"
                  />
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
