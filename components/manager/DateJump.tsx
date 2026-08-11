"use client";

import { useRouter, useSearchParams } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import { addDaysISO, todayISO } from "@/lib/format";

// Jump any dated screen straight to a date, keeping whatever filters are on
// the URL. Today drops the parameter entirely, so the plain URL always means
// "today" and the page can be bookmarked without pinning a date.
// label: set it when the picker sits beside other labelled filters, so the two
// read as a matched pair instead of one floating above the other.
export default function DateJump({
  date,
  basePath,
  label,
}: {
  date: string;
  basePath: string;
  label?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const today = todayISO();

  const picker = (
    <DatePicker
      value={date}
      min={addDaysISO(today, -730)}
      max={addDaysISO(today, 730)}
      onChange={(d) => {
        const p = new URLSearchParams(params.toString());
        if (d === today) p.delete("date");
        else p.set("date", d);
        const s = p.toString();
        router.push(`${basePath}${s ? `?${s}` : ""}`);
      }}
    />
  );

  if (!label) return picker;
  return (
    <div className="field">
      <label>{label}</label>
      {picker}
    </div>
  );
}
