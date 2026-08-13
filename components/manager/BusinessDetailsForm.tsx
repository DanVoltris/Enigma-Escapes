"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BusinessDetails } from "@/lib/settings";

const EMPTY: BusinessDetails = {
  companyName: "",
  phone: "",
  cell: "",
  email: "",
  website: "",
  taxLabel: "",
  taxNumber: "",
};

export default function BusinessDetailsForm({ initial }: { initial: BusinessDetails | null }) {
  const router = useRouter();
  const [d, setD] = useState<BusinessDetails>(initial ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof BusinessDetails) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setD({ ...d, [k]: e.target.value });
    setSaved(false);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/settings/business", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save. Please try again.");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mgr-card">
        <h2>Company name</h2>
        <p className="card-sub">Shown to customers on the booking site footer, and later on emails and receipts.</p>
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="bd-name">
            Company name <span className="req">*</span>
          </label>
          <input id="bd-name" type="text" value={d.companyName} onChange={set("companyName")} />
        </div>
      </div>

      <div className="mgr-card">
        <h2>Online / contact information</h2>
        <p className="card-sub">Optional, but recommended — it gives customers a way to reach you.</p>
        <div className="mgr-form">
          <div className="field-row-3">
            <div className="field">
              <label htmlFor="bd-phone">Business phone</label>
              <input id="bd-phone" type="tel" value={d.phone} onChange={set("phone")} />
            </div>
            <div className="field">
              <label htmlFor="bd-cell">Business cell</label>
              <input id="bd-cell" type="tel" value={d.cell} onChange={set("cell")} />
            </div>
            <div className="field">
              <label htmlFor="bd-email">Business email</label>
              <input id="bd-email" type="email" value={d.email} onChange={set("email")} />
            </div>
          </div>
          <div className="field" style={{ maxWidth: 420 }}>
            <label htmlFor="bd-web">Website</label>
            <input id="bd-web" type="text" value={d.website} onChange={set("website")} placeholder="https://…" />
          </div>
        </div>
      </div>

      <div className="mgr-card">
        <h2>Booking request alerts</h2>
        <p className="card-sub">
          Who gets a text the moment a booking request comes in. These are for sessions starting within the next few
          hours and they expire when the session starts, so nobody sees one unless they happen to have the Requests
          tab open. One number per line, up to ten.
        </p>
        <div className="mgr-form">
          <div className="field" style={{ maxWidth: 420 }}>
            <label htmlFor="bd-alerts">Numbers to text</label>
            <textarea
              id="bd-alerts"
              rows={4}
              value={(d.requestAlertNumbers ?? []).join("\n")}
              onChange={(e) =>
                setD((prev) => ({ ...prev, requestAlertNumbers: e.target.value.split("\n") }))
              }
              placeholder={"204 555 0134\n204 555 0198"}
            />
            <p className="field-hint">
              Leave empty and the alert goes to the business cell (or the business phone) instead, so a request is
              never missed entirely.
            </p>
          </div>
        </div>
      </div>

      <div className="mgr-card">
        <h2>Tax information</h2>
        <p className="card-sub">Shown on receipts when set (e.g. your GST registration). Rates live under Taxes &amp; fees.</p>
        <div className="mgr-form">
          <div className="field-row-3">
            <div className="field">
              <label htmlFor="bd-taxlabel">Label</label>
              <input
                id="bd-taxlabel"
                type="text"
                value={d.taxLabel}
                onChange={set("taxLabel")}
                placeholder="GST (Goods and Services Tax)"
              />
            </div>
            <div className="field">
              <label htmlFor="bd-taxnum">Number</label>
              <input id="bd-taxnum" type="text" value={d.taxNumber} onChange={set("taxNumber")} />
            </div>
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
