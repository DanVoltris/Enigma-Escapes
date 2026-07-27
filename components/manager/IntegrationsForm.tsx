"use client";

import { useState } from "react";
import { FB_PIXEL_RE, GTM_ID_RE, type IntegrationSettings } from "@/lib/integrations";

export default function IntegrationsForm({ initial }: { initial: IntegrationSettings }) {
  const [s, setS] = useState<IntegrationSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(next: Partial<IntegrationSettings>) {
    setS({ ...s, ...next });
    setSaved(false);
    setError(null);
  }

  async function save() {
    // The same checks the server enforces, caught early with a friendlier loop.
    if (s.fbEnabled && !FB_PIXEL_RE.test(s.fbPixelId.trim())) {
      setError("Enter a valid Facebook Pixel ID (8–20 digits) or turn Facebook Tracking off.");
      return;
    }
    if (s.gtmEnabled && !GTM_ID_RE.test(s.gtmId.trim().toUpperCase())) {
      setError("Enter a valid Google Tag Manager ID like GTM-ABC1234 or turn Google Tag Manager off.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/settings/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save. Please try again.");
      setS((data as { settings: IntegrationSettings }).settings);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mgr-card">
        <div className="intg-head">
          <h2>Facebook Tracking</h2>
          {s.fbEnabled && FB_PIXEL_RE.test(s.fbPixelId) && <span className="mgr-pill on">Active</span>}
        </div>
        <p className="card-sub">
          Track visitors, add-to-basket, checkout and completed bookings (with value) on your booking site, so
          Facebook &amp; Instagram ads can be measured and optimised. Runs on the customer site only.
        </p>
        <div className="mgr-form">
          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="intg-fb-id">Meta Pixel ID</label>
            <input
              id="intg-fb-id"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 1234567890123456"
              value={s.fbPixelId}
              onChange={(e) => patch({ fbPixelId: e.target.value })}
            />
            <p className="field-hint">
              Meta Events Manager → Data sources → your pixel → the numeric ID under its name.
            </p>
          </div>
          <label className="intg-toggle">
            <input type="checkbox" checked={s.fbEnabled} onChange={(e) => patch({ fbEnabled: e.target.checked })} />
            Enable Facebook Tracking on the booking site
          </label>
        </div>
      </div>

      <div className="mgr-card">
        <div className="intg-head">
          <h2>Google Tag Manager</h2>
          {s.gtmEnabled && GTM_ID_RE.test(s.gtmId) && <span className="mgr-pill on">Active</span>}
        </div>
        <p className="card-sub">
          Loads your GTM container on every customer page, so you can add Google Analytics, ads tags and more from
          Tag Manager without code changes. Booking events (add to basket, checkout, purchase) are pushed to the
          data layer automatically.
        </p>
        <div className="mgr-form">
          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="intg-gtm-id">Container ID</label>
            <input
              id="intg-gtm-id"
              type="text"
              placeholder="GTM-ABC1234"
              value={s.gtmId}
              onChange={(e) => patch({ gtmId: e.target.value.toUpperCase() })}
            />
            <p className="field-hint">Tag Manager → your container — the ID next to its name.</p>
          </div>
          <label className="intg-toggle">
            <input type="checkbox" checked={s.gtmEnabled} onChange={(e) => patch({ gtmEnabled: e.target.checked })} />
            Enable Google Tag Manager on the booking site
          </label>
        </div>
      </div>

      <div className="mgr-card">
        <h2>Morty</h2>
        <p className="card-sub">
          Morty is an escape-room discovery app that lists venues with live availability. Listing requires a
          partner integration on Morty&apos;s side — there&apos;s no ID to paste. If you pursue a partnership
          (mortyapp.com), the site can expose an availability feed for them; ask and it will be built.
        </p>
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
