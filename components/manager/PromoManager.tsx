"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Promo } from "@/lib/types";

export default function PromoManager({ promos }: { promos: Promo[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addPromo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/manager/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, percentOff: Number(percent) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save the code.");
      setCode("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the code.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(promo: Promo) {
    setError(null);
    try {
      const res = await fetch(`/api/manager/promos/${encodeURIComponent(promo.code)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !promo.active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update the code.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the code.");
    }
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="mgr-card">
        <h2>Add a code</h2>
        <p className="card-sub">Customers type this at checkout to get the discount.</p>
        <form className="mgr-inline-form" onSubmit={addPromo}>
          <div className="field">
            <label htmlFor="promo-code">Code</label>
            <input
              id="promo-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. SUMMER20"
              style={{ minWidth: 200, textTransform: "uppercase" }}
            />
          </div>
          <div className="field">
            <label htmlFor="promo-percent">Discount (%)</label>
            <input
              id="promo-percent"
              type="text"
              inputMode="numeric"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              style={{ width: 100 }}
            />
          </div>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Adding…" : "Add code"}
          </button>
        </form>
      </div>

      <div className="mgr-card">
        <h2>Your codes</h2>
        <p className="card-sub">
          Turning a code off stops new uses immediately; bookings already made keep their discount.
        </p>
        {promos.length === 0 ? (
          <p className="mgr-empty">No codes yet — add your first one above.</p>
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th className="num">Discount</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <tr key={p.code}>
                    <td>
                      <strong>{p.code}</strong>
                    </td>
                    <td className="num">{p.percentOff}% off</td>
                    <td>
                      <span className={`mgr-pill${p.active ? " on" : ""}`}>{p.active ? "Active" : "Off"}</span>
                    </td>
                    <td>
                      <button type="button" className="link-button" onClick={() => toggle(p)}>
                        {p.active ? "Turn off" : "Turn on"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
