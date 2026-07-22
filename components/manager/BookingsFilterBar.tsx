"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import SingleSelect from "@/components/SingleSelect";
import { addDaysISO, todayISO } from "@/lib/format";

// Earliest selectable purchase date in the custom range picker.
const EARLIEST = "2026-01-01";

// Resova-style transaction filters, driven through the URL so the server does
// the filtering: live search (debounced, no button), purchase-date range with
// presets + custom from/to, status and payments dropdowns. Uses the site's own
// SingleSelect/DatePicker so nothing renders with the OS-native look.
export default function BookingsFilterBar() {
  const router = useRouter();
  const params = useSearchParams();
  const today = todayISO();

  const urlQ = params.get("q") ?? "";
  const range = params.get("range") ?? "30d";
  const from = params.get("from") ?? addDaysISO(today, -30);
  const to = params.get("to") ?? today;
  const status = params.get("status") ?? "all";
  const pay = params.get("pay") ?? "all";
  const date = params.get("date"); // session-date link from the calendar

  const [q, setQ] = useState(urlQ);

  function replaceWith(over: Record<string, string>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(over)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.replace(`/manager/bookings?${p.toString()}`, { scroll: false });
  }

  // Live search: apply 300ms after the user stops typing.
  useEffect(() => {
    if (q === urlQ) return;
    const t = setTimeout(() => replaceWith({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, urlQ]);

  function setRange(v: string) {
    if (v === "custom") {
      // Seed the pickers with the last 30 days; staff adjusts from there.
      replaceWith({ range: "custom", from: addDaysISO(today, -30), to: today });
    } else {
      replaceWith({ range: v === "30d" ? "" : v, from: "", to: "" });
    }
  }

  const anyFilter = urlQ || range !== "30d" || status !== "all" || pay !== "all" || date;

  return (
    <div className="mgr-inline-form" style={{ rowGap: 14 }}>
      <div className="field">
        <label htmlFor="bf-q">Search</label>
        <input
          type="text"
          id="bf-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, email, phone, reference or experience"
          style={{ minWidth: 300 }}
        />
      </div>
      <div className="field" style={{ minWidth: 170 }}>
        <label>Purchase date</label>
        <SingleSelect
          value={range}
          onChange={setRange}
          ariaLabel="Filter by purchase date"
          options={[
            { value: "30d", label: "Last 30 days" },
            { value: "7d", label: "Last 7 days" },
            { value: "24h", label: "Last 24 hours" },
            { value: "all", label: "All time" },
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
      <div className="field" style={{ minWidth: 130 }}>
        <label>Status</label>
        <SingleSelect
          value={status}
          onChange={(v) => replaceWith({ status: v === "all" ? "" : v })}
          ariaLabel="Filter by status"
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Attending" },
            { value: "noshow", label: "No-show" },
          ]}
        />
      </div>
      <div className="field" style={{ minWidth: 130 }}>
        <label>Payments</label>
        <SingleSelect
          value={pay}
          onChange={(v) => replaceWith({ pay: v === "all" ? "" : v })}
          ariaLabel="Filter by payment state"
          options={[
            { value: "all", label: "All" },
            { value: "paid", label: "Paid" },
            { value: "unpaid", label: "Unpaid" },
          ]}
        />
      </div>
      {anyFilter && (
        <Link href="/manager/bookings" className="btn btn-outline">
          Clear
        </Link>
      )}
    </div>
  );
}
