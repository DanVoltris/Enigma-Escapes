"use client";

import { useState } from "react";
import SingleSelect from "@/components/SingleSelect";

const ADD_NEW = "__add_new__";

// Pick from existing locations or add a new one. Existing locations are the
// distinct location values across all experiences (there's no separate table).
export default function LocationPicker({
  value,
  onChange,
  locations,
}: {
  value: string;
  onChange: (v: string) => void;
  locations: string[];
}) {
  // Start typing a new one when there are none yet, or the current value isn't
  // one of the known locations.
  const [adding, setAdding] = useState(locations.length === 0 || (!!value && !locations.includes(value)));

  if (adding) {
    return (
      <div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Downtown location"
          autoFocus
        />
        {locations.length > 0 && (
          <button
            type="button"
            className="link-button"
            style={{ marginTop: 8 }}
            onClick={() => {
              setAdding(false);
              onChange(locations[0]);
            }}
          >
            ← Choose an existing location
          </button>
        )}
      </div>
    );
  }

  const options = [
    ...locations.map((l) => ({ value: l, label: l })),
    { value: ADD_NEW, label: "+ Add a new location" },
  ];

  return (
    <SingleSelect
      ariaLabel="Location"
      value={value || locations[0]}
      options={options}
      onChange={(v) => {
        if (v === ADD_NEW) {
          setAdding(true);
          onChange("");
        } else {
          onChange(v);
        }
      }}
    />
  );
}
