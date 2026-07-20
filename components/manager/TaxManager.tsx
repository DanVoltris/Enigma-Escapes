"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Tax } from "@/lib/types";

export default function TaxManager({ taxes }: { taxes: Tax[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [percent, setPercent] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const activePercent = taxes.filter((t) => t.active).reduce((s, t) => s + t.percent, 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    const pct = Number(percent);
    if (!trimmed) return setError("Give the tax a name, e.g. GST or PST.");
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return setError("Percentage must be between 0 and 100.");

    setBusy(true);
    try {
      const res = await fetch("/api/manager/taxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, percent: pct }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add the tax.");
      setName("");
      setPercent("5");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the tax.");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch(`/api/manager/taxes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update the tax.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the tax.");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/manager/taxes/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not remove the tax.");
      setConfirmId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the tax.");
    }
  }

  return (
    <>
      <p className="mgr-page-sub">
        Taxes applied to every booking at checkout. Active taxes are summed — customers currently pay{" "}
        <strong>{activePercent}%</strong> tax.
      </p>

      {error && <div className="error-banner">{error}</div>}

      <div className="mgr-card">
        <h2>Add a tax</h2>
        <form onSubmit={add}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="taxName">Name</label>
              <input
                id="taxName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. GST"
              />
            </div>
            <div className="field">
              <label htmlFor="taxPct">Percentage (%)</label>
              <input
                id="taxPct"
                type="text"
                inputMode="decimal"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
              />
            </div>
          </div>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Adding…" : "Add tax"}
          </button>
        </form>
      </div>

      <div className="mgr-card">
        <h2>Your taxes</h2>
        <p className="card-sub">
          Turning a tax off stops it applying to new bookings; bookings already made keep the tax they were charged.
        </p>
        {taxes.length === 0 ? (
          <p className="mgr-empty">No taxes yet. Add one above.</p>
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Rate</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {taxes.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className="num">{t.percent}%</td>
                    <td>
                      <span className={`mgr-pill${t.active ? " on" : ""}`}>{t.active ? "Active" : "Off"}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                        <button type="button" className="link-button" onClick={() => patch(t.id, { active: !t.active })}>
                          {t.active ? "Turn off" : "Turn on"}
                        </button>
                        {confirmId === t.id ? (
                          <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Remove?</span>
                            <button type="button" className="link-button danger" onClick={() => remove(t.id)}>
                              Yes, remove
                            </button>
                            <button type="button" className="link-button" onClick={() => setConfirmId(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="link-button danger" onClick={() => setConfirmId(t.id)}>
                            Remove
                          </button>
                        )}
                      </div>
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
