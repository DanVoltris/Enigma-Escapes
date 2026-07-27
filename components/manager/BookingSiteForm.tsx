"use client";

import { useEffect, useState } from "react";
import type { SiteSettings } from "@/lib/site-settings";

type TabKey = "availability" | "colors" | "basket" | "content";

const TABS: { key: TabKey; label: string }[] = [
  { key: "availability", label: "Availability" },
  { key: "colors", label: "Logo & colours" },
  { key: "basket", label: "Shopping basket" },
  { key: "content", label: "Content" },
];

// Mirrors the server-side limit in the upload API (lib/storage.ts).
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

// The dominant colours of an image, as hex strings, most prominent first.
// Downscales onto a canvas and buckets similar pixels — no libraries needed.
async function extractPalette(src: string): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = "anonymous"; // needed to read pixels of bucket-hosted logos
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not read the image."));
    img.src = src;
  });

  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  // Bucket pixels on a coarse RGB grid, averaging the true colour per bucket.
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // transparent
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 242 && g > 242 && b > 242) continue; // near-white (usually the background)
    opaque++;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const e = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    e.count++;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(key, e);
  }

  const minCount = Math.max(4, opaque * 0.02); // ignore stray noise pixels
  const picked: { r: number; g: number; b: number }[] = [];
  for (const e of [...buckets.values()].sort((a, b) => b.count - a.count)) {
    if (e.count < minCount) break;
    const r = Math.round(e.r / e.count);
    const g = Math.round(e.g / e.count);
    const b = Math.round(e.b / e.count);
    // skip shades too close to an already-picked colour
    if (picked.some((p) => Math.abs(p.r - r) + Math.abs(p.g - g) + Math.abs(p.b - b) < 60)) continue;
    picked.push({ r, g, b });
    if (picked.length >= 6) break;
  }
  return picked.map(({ r, g, b }) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
}

export default function BookingSiteForm({ initial }: { initial: SiteSettings }) {
  const [s, setS] = useState<SiteSettings>(initial);
  const [tab, setTab] = useState<TabKey>("availability");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [palette, setPalette] = useState<string[]>([]);
  const [logoBusy, setLogoBusy] = useState(false);

  // Recover the swatches for an already-saved logo when the page loads.
  useEffect(() => {
    if (initial.logoUrl) extractPalette(initial.logoUrl).then(setPalette).catch(() => {});
  }, [initial.logoUrl]);

  function patch(next: Partial<SiteSettings>) {
    setS({ ...s, ...next });
    setSaved(false);
  }

  async function onLogoFile(file: File) {
    if (file.size > MAX_LOGO_BYTES) {
      setError("Logo is too large — keep it under 5 MB.");
      return;
    }
    setLogoBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/manager/upload", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not upload the logo. Please try again.");
      patch({ logoUrl: data.url });
      // Colour extraction is a bonus — an unreadable image shouldn't fail the upload.
      setPalette(await extractPalette(data.url).catch(() => []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the logo. Please try again.");
    } finally {
      setLogoBusy(false);
    }
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
            <h2>Logo &amp; colours</h2>
            <p className="card-sub">
              Applied to the customer booking site only — the manager portal keeps its own styling.
            </p>
            <div className="mgr-form">
              <div className="field">
                <label htmlFor="bs-logo">Logo</label>
                {s.logoUrl && (
                  <div className="bs-logo-row">
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URLs in local mode */}
                    <img src={s.logoUrl} alt="Current logo" className="bs-logo-preview" />
                    <button
                      type="button"
                      className="link-button danger"
                      onClick={() => {
                        patch({ logoUrl: null });
                        setPalette([]);
                      }}
                    >
                      Remove logo
                    </button>
                  </div>
                )}
                <input
                  id="bs-logo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={logoBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onLogoFile(f);
                    e.target.value = ""; // allow re-selecting the same file
                  }}
                />
                <p className="field-hint">
                  {logoBusy
                    ? "Uploading and reading colours…"
                    : "JPG, PNG or WebP, up to 5 MB. Shown in place of the site name in the booking site header. Remember to Save & update."}
                </p>
              </div>

              {palette.length > 0 && (
                <div className="field">
                  <label>Colours from your logo</label>
                  <div className="bs-swatches">
                    {palette.map((hexColor) => (
                      <button
                        key={hexColor}
                        type="button"
                        className={`bs-swatch${s.brandColor === hexColor ? " selected" : ""}`}
                        style={{ background: hexColor }}
                        title={`Use ${hexColor} as the accent`}
                        aria-label={`Use ${hexColor} as the accent colour`}
                        onClick={() => patch({ brandColor: hexColor, buttonBg: hexColor })}
                      />
                    ))}
                  </div>
                  <p className="field-hint">
                    Click a colour to use it as your accent (brand colour and button background) — or pick any custom
                    colour below.
                  </p>
                </div>
              )}

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
