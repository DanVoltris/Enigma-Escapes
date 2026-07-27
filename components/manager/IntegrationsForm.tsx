"use client";

import { useState } from "react";
import { FB_PIXEL_RE, GTM_ID_RE, type IntegrationSettings } from "@/lib/integrations";

export type StripeStatus = { mode: "test" | "live" | null; webhook: boolean };

export default function IntegrationsForm({ initial, stripe }: { initial: IntegrationSettings; stripe: StripeStatus }) {
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
          <h2>Stripe</h2>
          {stripe.mode ? (
            <span className="mgr-pill on">Active — {stripe.mode === "live" ? "LIVE" : "test mode"}</span>
          ) : (
            <span className="mgr-pill">Ready — add your keys</span>
          )}
        </div>
        <p className="card-sub">
          Accept real card payments online with Stripe&apos;s hosted checkout (cards, Apple Pay, Google Pay). Until
          it&apos;s configured, the payment step stays simulated — no one is charged.
        </p>
        {stripe.mode ? (
          <p className="card-sub">
            Payments are on{stripe.mode === "test" ? " in test mode (use card 4242 4242 4242 4242)" : ""}. Webhook:{" "}
            {stripe.webhook ? "configured — bookings finalize even if the customer closes the tab." : (
              <strong>not configured — add STRIPE_WEBHOOK_SECRET so bookings finalize reliably.</strong>
            )}
          </p>
        ) : (
          <>
            <p className="card-sub">
              For security, Stripe keys live in environment variables — not on this page (this portal has no login
              yet). To enable: create a Stripe account, then add to <code>.env.local</code> (and Vercel):
            </p>
            <pre className="intg-code">{`STRIPE_SECRET_KEY=rk_test_...   # restricted key: Dashboard → Developers → API keys
STRIPE_WEBHOOK_SECRET=whsec_... # Dashboard → Webhooks → endpoint /api/stripe/webhook
                                # event: checkout.session.completed`}</pre>
            <p className="card-sub">
              Using Supabase? The bookings table needs two new columns first — run in the SQL editor:
            </p>
            <pre className="intg-code">{`alter table bookings
  add column if not exists status text,
  add column if not exists pending_expires_at timestamptz;`}</pre>
          </>
        )}
      </div>

      <div className="mgr-card">
        <div className="intg-head">
          <h2>Facebook Tracking</h2>
          {s.fbEnabled && FB_PIXEL_RE.test(s.fbPixelId) ? (
            <span className="mgr-pill on">Active</span>
          ) : (
            <span className="mgr-pill">Ready — paste your Pixel ID</span>
          )}
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
          {s.gtmEnabled && GTM_ID_RE.test(s.gtmId) ? (
            <span className="mgr-pill on">Active</span>
          ) : (
            <span className="mgr-pill">Ready — paste your container ID</span>
          )}
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
        <div className="intg-head">
          <h2>Morty</h2>
          <span className="mgr-pill">Requires a Morty partnership</span>
        </div>
        <p className="card-sub">
          Morty is an escape-room discovery app that lists venues with live availability. Listing requires a
          partner integration on Morty&apos;s side — there&apos;s no ID to paste. If you pursue a partnership
          (mortyapp.com), the site can expose an availability feed for them; ask and it will be built.
        </p>
      </div>

      <div className="mgr-card">
        <div className="intg-head">
          <h2>Fotaflo</h2>
          <span className="mgr-pill">Requires a Fotaflo partnership</span>
        </div>
        <p className="card-sub">
          Photo &amp; video delivery for guests. Like Morty, Fotaflo connects through a partner API on their side
          rather than a pasted ID — contact Fotaflo about connecting your booking system, and the booking feed for
          them can be built here once you have access.
        </p>
      </div>

      <div className="mgr-card">
        <div className="intg-head">
          <h2>Zoom</h2>
          <span className="mgr-pill">On hold — needs booking emails first</span>
        </div>
        <p className="card-sub">
          Auto-creating Zoom meetings for remote games needs booking emails first (the app doesn&apos;t send email
          yet) — so this integration is on hold until email exists. If you run virtual games today, a per-experience
          meeting link shown on the confirmation page is a quick interim option; ask and it will be added.
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
