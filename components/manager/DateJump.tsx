"use client";

import { useRouter, useSearchParams } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import { addDaysISO, todayISO } from "@/lib/format";

// Jump any dated screen straight to a date, keeping whatever filters are on
// the URL. Today drops the parameter entirely, so the plain URL always means
// "today" and the page can be bookmarked without pinning a date.
export default function DateJump({ date, basePath }: { date: string; basePath: string }) {
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
        router.push(`${basePath}${s ? `?${s}` : ""}`);
      }}
    />
  );
}
