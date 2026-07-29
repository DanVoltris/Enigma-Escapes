"use client";

import { useRouter, useSearchParams } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import SingleSelect from "@/components/SingleSelect";
import { addDaysISO, todayISO } from "@/lib/format";

const EARLIEST = "2026-01-01";

// Filter row for Dashboard → Venue performance: range presets with a custom
// from/to, plus a location filter. Mirrors ReportsFilterBar.
export default function PerfFilter({ locations }: { locations: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const today = todayISO();

  const range = params.get("range") ?? "30";
  const from = params.get("from") ?? addDaysISO(today, -30);
  const to = params.get("to") ?? today;
  const loc = params.get("loc") ?? "all";

  function replaceWith(over: Record<string, string>) {
    const p = new URLSearchParams(params.toString());
    p.set("view", "performance");
    for (const [k, v] of Object.entries(over)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.replace(`/manager?${p.toString()}`, { scroll: false });
  }

  function setRange(v: string) {
    if (v === "custom") replaceWith({ range: "custom", from: addDaysISO(today, -30), to: today });
    else replaceWith({ range: v, from: "", to: "" });
  }

  return (
    <div className="mgr-inline-form" style={{ rowGap: 14 }}>
      <div className="field" style={{ minWidth: 170 }}>
        <label>Date range</label>
        <SingleSelect
          value={range}
          onChange={setRange}
          ariaLabel="Performance date range"
          options={[
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
            { value: "custom", label: "Custom range" },
          ]}
        />
      </div>
      {range === "custom" && (
        <>
          <div className="field">
            <label>From</label>
            <DatePicker value={from} min={EARLIEST} max={to} onChange={(d) => replaceWith({ from: d })} />
          </div>
          <div className="field">
            <label>To</label>
            <DatePicker value={to} min={from} max={today} onChange={(d) => replaceWith({ to: d })} />
          </div>
        </>
      )}
      {locations.length > 1 && (
        <div className="field" style={{ minWidth: 170 }}>
          <label>Location</label>
          <SingleSelect
            value={loc}
            onChange={(v) => replaceWith({ loc: v === "all" ? "" : v })}
            ariaLabel="Location"
            options={[{ value: "all", label: "All locations" }, ...locations.map((l) => ({ value: l, label: l }))]}
          />
        </div>
      )}
    </div>
  );
}
