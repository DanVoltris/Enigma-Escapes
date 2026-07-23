"use client";

import { useState } from "react";
import type { SiteSettings } from "@/lib/site-settings";

type TabKey = "availability" | "colors" | "basket" | "content";

const TABS: { key: TabKey; label: string }[] = [
  { key: "availability", label: "Availability" },
  { key: "colors", label: "Colours" },
  { key: "basket", label: "Shopping basket" },
  { key: "content", label: "Content" },
];

export default function BookingSiteForm({ initial }: { initial: SiteSettings }) {
  const [s, setS] = useState<SiteSettings>(initial);
  const [tab, setTab] = useState<TabKey>("availability");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(next: Partial<SiteSettings>) {
    setS({ ...s, ...next });
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/settings/booking-site", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
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

  const colorField = (label: string, key: "brandColor" | "buttonBg" | "buttonText", hint: string) => (
    <div className="field">
      <label htmlFor={`bs-${key}`}>{label}</label>
      <div className="bs-color">
        <input
          id={`bs-${key}`}
          type="color"
          value={s[key]}
          onChange={(e) => patch({ [key]: e.target.value } as Partial<SiteSettings>)}
        />
        <input
          type="text"
          value={s[key]}
          onChange={(e) => patch({ [key]: e.target.value } as Partial<SiteSettings>)}
          aria-label={`${label} hex value`}
          style={{ width: 120 }}
        />
      </div>
      <p className="field-hint">{hint}</p>
    </div>
  );

  return (
    <>
      <div className="cust-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`cust-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mgr-card">
        {tab === "availability" && (
          <>
            <h2>Availability</h2>
            <p className="card-sub">
              How far ahead customers can book, and the wording on each time slot. The booking window is enforced on the
              server too, so it can&apos;t be bypassed.
            </p>
            <div className="mgr-form">
              <div className="field" style={{ maxWidth: 220 }}>
                <label htmlFor="bs-window">Days in advance</label>
                <input
                  id="bs-window"
                  type="number"
                  min="1"
                  max="365"
                  value={s.windowDays}
                  onChange={(e) => patch({ windowDays: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
                />
                <p className="field-hint">Customers can book from today up to this many days ahead.</p>
              </div>
              <div className="field-row-3">
                <div className="field">
                  <label htmlFor="bs-available">Available slot label</label>
                  <input
                    id="bs-available"
                    type="text"
                    value={s.availableLabel}
                    onChange={(e) => patch({ availableLabel: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="bs-soldout">Sold out slot label</label>
                  <input
                    id="bs-soldout"
                    type="text"
                    value={s.soldOutLabel}
                    onChange={(e) => patch({ soldOutLabel: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {tab === "colors" && (
          <>
            <h2>Colours</h2>
            <p className="card-sub">
              Applied to the customer booking site only — the manager portal keeps its own styling.
            </p>
            <div className="mgr-form">
              <div className="field-row-3">
                {colorField("Brand colour", "brandColor", "Highlights, selected states and accents.")}
                {colorField("Button background", "buttonBg", "Primary buttons like “Book now”.")}
                {colorField("Button text", "buttonText", "Text on those buttons — keep the contrast readable.")}
              </div>
            </div>
          </>
        )}

        {tab === "basket" && (
          <>
            <h2>Shopping basket</h2>
            <p className="card-sub">
              How long a customer&apos;s selected slots are held while they check out, and what they see when that time
              runs out.
            </p>
            <div className="mgr-form">
              <div className="field" style={{ maxWidth: 220 }}>
                <label htmlFor="bs-hold">Basket expires after</label>
                <input
                  id="bs-hold"
                  type="number"
                  min="1"
                  max="120"
                  value={s.holdMinutes}
                  onChange={(e) => patch({ holdMinutes: Math.max(1, Math.min(120, Number(e.target.value) || 1)) })}
                />
                <p className="field-hint">Minutes from when the first slot is added.</p>
              </div>
              <div className="field" style={{ maxWidth: 640 }}>
                <label htmlFor="bs-expired">Basket expired message</label>
                <textarea
                  id="bs-expired"
                  rows={3}
                  value={s.basketExpiredText}
                  onChange={(e) => patch({ basketExpiredText: e.target.value })}
                />
              </div>
            </div>
          </>
        )}

        {tab === "content" && (
          <>
            <h2>Content</h2>
            <p className="card-sub">
              Optional copy for the booking site. Leave a field empty to hide it entirely.
            </p>
            <div className="mgr-form">
              <div className="field" style={{ maxWidth: 520 }}>
                <label htmlFor="bs-heading">Intro heading</label>
                <input
                  id="bs-heading"
                  type="text"
                  value={s.introHeading}
                  onChange={(e) => patch({ introHeading: e.target.value })}
                  placeholder="e.g. Book your escape"
                />
              </div>
              <div className="field" style={{ maxWidth: 640 }}>
                <label htmlFor="bs-introtext">Intro text</label>
                <textarea
                  id="bs-introtext"
                  rows={3}
                  value={s.introText}
                  onChange={(e) => patch({ introText: e.target.value })}
                  placeholder="A short welcome line shown above the rooms."
                />
              </div>
              <div className="field" style={{ maxWidth: 640 }}>
                <label htmlFor="bs-support">Booking support line</label>
                <textarea
                  id="bs-support"
                  rows={2}
                  value={s.supportText}
                  onChange={(e) => patch({ supportText: e.target.value })}
                  placeholder="e.g. Need a hand? Call us on 204-219-0014."
                />
              </div>
            </div>
          </>
        )}
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
