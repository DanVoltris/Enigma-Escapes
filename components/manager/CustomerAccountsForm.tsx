"use client";

import { useState } from "react";
import SingleSelect from "@/components/SingleSelect";
import type { BookingPolicies, BookingPolicy } from "@/lib/settings";

type TabKey = "reschedule" | "cancellation";

const UNITS = [
  { value: "days", label: "day(s) before the session" },
  { value: "weeks", label: "week(s) before the session" },
  { value: "months", label: "month(s) before the session" },
];

export default function CustomerAccountsForm({ initial }: { initial: BookingPolicies }) {
  const [policies, setPolicies] = useState<BookingPolicies>(initial);
  const [tab, setTab] = useState<TabKey>("reschedule");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verb = tab === "reschedule" ? "reschedule" : "cancel";
  const p = policies[tab];

  function patch(next: Partial<BookingPolicy>) {
    setPolicies({ ...policies, [tab]: { ...p, ...next } });
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/settings/policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policies),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save. Please try again.");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="cust-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "reschedule"}
          className={`cust-tab${tab === "reschedule" ? " active" : ""}`}
          onClick={() => setTab("reschedule")}
        >
          Rescheduling / updating
        </button>
        <button
          role="tab"
          aria-selected={tab === "cancellation"}
          className={`cust-tab${tab === "cancellation" ? " active" : ""}`}
          onClick={() => setTab("cancellation")}
        >
          Cancellations
        </button>
      </div>

      <div className="mgr-card">
        <h2>{tab === "reschedule" ? "Rescheduling / updating policy" : "Cancellation policy"}</h2>
        <p className="card-sub">
          This is the policy text shown to customers on their booking confirmation page. It states your terms — the app
          doesn&apos;t offer self-service {verb}ling yet (that needs customer accounts), so customers act on it by
          contacting you.
        </p>

        <label className="checkbox-row" style={{ marginBottom: 20 }}>
          <input type="checkbox" checked={p.show} onChange={(e) => patch({ show: e.target.checked })} />
          <span>Show this policy on the booking confirmation page</span>
        </label>

        <div className="mgr-form">
          <div className="field-row-3">
            <div className="field">
              <label htmlFor="ca-value">Customers can {verb} up to…</label>
              <input
                id="ca-value"
                type="number"
                min="1"
                max="365"
                value={p.cutoffValue}
                onChange={(e) => patch({ cutoffValue: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
                style={{ width: 90 }}
              />
            </div>
            <div className="field">
              <label>Before the session</label>
              <SingleSelect
                value={p.cutoffUnit}
                onChange={(v) => patch({ cutoffUnit: v as BookingPolicy["cutoffUnit"] })}
                ariaLabel="Cutoff unit"
                options={UNITS}
              />
            </div>
          </div>

          <div className="field" style={{ maxWidth: 520 }}>
            <label htmlFor="ca-title">Title</label>
            <input id="ca-title" type="text" value={p.title} onChange={(e) => patch({ title: e.target.value })} />
          </div>

          <div className="field" style={{ maxWidth: 640 }}>
            <label htmlFor="ca-content">Content</label>
            <textarea
              id="ca-content"
              value={p.content}
              onChange={(e) => patch({ content: e.target.value })}
              rows={4}
              placeholder="Explain how customers can reschedule or cancel, any deadlines, fees, and how to reach you."
            />
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button type="button" className="btn" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save & update"}
        </button>
        {saved && <span className="mgr-pill on">Saved</span>}
        {error && <span className="field-error">{error}</span>}
      </div>
    </>
  );
}
