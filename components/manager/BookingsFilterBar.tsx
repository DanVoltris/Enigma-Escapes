"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

// Resova-style transaction filters, driven through the URL so the server does
// the filtering: live search (debounced, no button), purchase-date range with
// presets + custom from/to, status and payments dropdowns.
export default function BookingsFilterBar() {
  const router = useRouter();
  const params = useSearchParams();

  const urlQ = params.get("q") ?? "";
  const range = params.get("range") ?? "30d";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
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
      <div className="field">
        <label htmlFor="bf-range">Purchase date</label>
        <select
          id="bf-range"
          value={range}
          onChange={(e) => replaceWith({ range: e.target.value === "30d" ? "" : e.target.value, from: "", to: "" })}
        >
          <option value="30d">Last 30 days</option>
          <option value="7d">Last 7 days</option>
          <option value="24h">Last 24 hours</option>
          <option value="all">All time</option>
          <option value="custom">Custom range</option>
        </select>
      </div>
      {range === "custom" && (
        <>
          <div className="field">
            <label htmlFor="bf-from">From</label>
            <input type="date" id="bf-from" value={from} onChange={(e) => replaceWith({ from: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="bf-to">To</label>
            <input type="date" id="bf-to" value={to} onChange={(e) => replaceWith({ to: e.target.value })} />
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="bf-status">Status</label>
        <select
          id="bf-status"
          value={status}
          onChange={(e) => replaceWith({ status: e.target.value === "all" ? "" : e.target.value })}
        >
          <option value="all">All</option>
          <option value="active">Attending</option>
          <option value="noshow">No-show</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="bf-pay">Payments</label>
        <select
          id="bf-pay"
          value={pay}
          onChange={(e) => replaceWith({ pay: e.target.value === "all" ? "" : e.target.value })}
        >
          <option value="all">All</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
      </div>
      {anyFilter && (
        <Link href="/manager/bookings" className="btn btn-outline">
          Clear
        </Link>
      )}
    </div>
  );
}
