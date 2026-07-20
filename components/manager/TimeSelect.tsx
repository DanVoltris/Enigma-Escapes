"use client";

import SingleSelect from "@/components/SingleSelect";
import { formatTime } from "@/lib/format";

// Times of day at 15-minute steps, formatted 12-hour. Built once.
const OPTIONS = (() => {
  const out: { value: string; label: string }[] = [];
  for (let m = 0; m < 24 * 60; m += 15) {
    const v = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    out.push({ value: v, label: formatTime(v) });
  }
  return out;
})();

export default function TimeSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return <SingleSelect ariaLabel={ariaLabel} value={value} options={OPTIONS} onChange={onChange} />;
}
