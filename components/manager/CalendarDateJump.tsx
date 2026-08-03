"use client";

import { useRouter, useSearchParams } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import { addDaysISO, todayISO } from "@/lib/format";

// Jump the calendar straight to any date, keeping the current view + filters.
// (The Prev/Next links only step a day or a week at a time.)
export default function CalendarDateJump({ date }: { date: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const today = todayISO();

  return (
    <DatePicker
      value={date}
      min={addDaysISO(today, -730)}
      max={addDaysISO(today, 730)}
      onChange={(d) => {
        const p = new URLSearchParams(params.toString());
        if (d === today) p.delete("date");
        else p.set("date", d);
        const s = p.toString();
        router.push(`/manager/calendar${s ? `?${s}` : ""}`);
      }}
    />
  );
}
