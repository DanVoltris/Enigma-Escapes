"use client";

import { useRouter, useSearchParams } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import SingleSelect from "@/components/SingleSelect";
import { addDaysISO, todayISO } from "@/lib/format";

const EARLIEST = "2026-01-01";

// Shared filter row for the Reports tabs: date-range presets with a custom
// from/to, plus an optional transaction-status filter (Sales tab only).
// `future` flips it forward for the Upcoming tab (next N days instead of last).
export default function ReportsFilterBar({ withStatus, future }: { withStatus?: boolean; future?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const today = todayISO();

  const range = params.get("range") ?? "7";
  const from = params.get("from") ?? (future ? today : addDaysISO(today, -30));
  const to = params.get("to") ?? (future ? addDaysISO(today, 29) : today);
  const status = params.get("status") ?? "all";

  function replaceWith(over: Record<string, string>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(over)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.replace(`/manager/reports?${p.toString()}`, { scroll: false });
  }

  function setRange(v: string) {
    if (v === "custom") {
      replaceWith(
        future
          ? { range: "custom", from: today, to: addDaysISO(today, 29) }
          : { range: "custom", from: addDaysISO(today, -30), to: today }
      );
    } else replaceWith({ range: v === "7" ? "" : v, from: "", to: "" });
  }

  return (
    <div className="mgr-inline-form" style={{ rowGap: 14, marginBottom: 24 }}>
      <div className="field" style={{ minWidth: 170 }}>
        <label>Date range</label>
        <SingleSelect
          value={range}
          onChange={setRange}
          ariaLabel="Report date range"
          options={[
            { value: "7", label: future ? "Next 7 days" : "Last 7 days" },
            { value: "30", label: future ? "Next 30 days" : "Last 30 days" },
            { value: "90", label: future ? "Next 90 days" : "Last 90 days" },
            { value: "custom", label: "Custom range" },
          ]}
        />
      </div>
      {range === "custom" && (
        <>
          <div className="field">
            <label>From</label>
            <DatePicker
              value={from}
              min={future ? today : EARLIEST}
              max={to}
              onChange={(d) => replaceWith({ from: d })}
            />
          </div>
          <div className="field">
            <label>To</label>
            <DatePicker
              value={to}
              min={from}
              max={future ? addDaysISO(today, 365) : today}
              onChange={(d) => replaceWith({ to: d })}
            />
          </div>
        </>
      )}
      {withStatus && (
        <div className="field" style={{ minWidth: 170 }}>
          <label>Transaction status</label>
          <SingleSelect
            value={status}
            onChange={(v) => replaceWith({ status: v === "all" ? "" : v })}
            ariaLabel="Transaction status"
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Attending" },
              { value: "noshow", label: "No-show" },
            ]}
          />
        </div>
      )}
    </div>
  );
}
