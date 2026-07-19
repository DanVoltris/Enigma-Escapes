"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Experience } from "@/lib/types";

// Preset badge colour pairs (background / text) so managers pick from swatches
// that already meet contrast, instead of a free-form OS colour picker.
const COLOR_PRESETS: { bg: string; fg: string; name: string }[] = [
  { bg: "#0B2540", fg: "#FFFFFF", name: "Navy" },
  { bg: "#16212B", fg: "#FFFFFF", name: "Ink" },
  { bg: "#2E6E91", fg: "#FFFFFF", name: "Steel blue" },
  { bg: "#417B9E", fg: "#FFFFFF", name: "Slate blue" },
  { bg: "#1877B8", fg: "#FFFFFF", name: "Bright blue" },
  { bg: "#57B6F0", fg: "#0B2540", name: "Sky" },
  { bg: "#87CEFA", fg: "#0B2540", name: "Light sky" },
  { bg: "#5B6770", fg: "#FFFFFF", name: "Gray" },
];

export default function ExperienceForm({ initial }: { initial?: Experience }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [tagline, setTagline] = useState(initial?.tagline ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [duration, setDuration] = useState(String(initial?.durationMinutes ?? 60));
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? 10));
  const [price, setPrice] = useState(initial ? (initial.priceCents / 100).toFixed(2) : "30.00");
  const [timesText, setTimesText] = useState(initial?.times.join(", ") ?? "10:00, 11:30, 13:00, 14:30, 16:00, 17:30, 19:00, 20:30");
  const [colorIdx, setColorIdx] = useState(() => {
    const found = COLOR_PRESETS.findIndex((p) => p.bg.toLowerCase() === (initial?.badgeBg ?? "").toLowerCase());
    return found >= 0 ? found : 0;
  });
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const priceNumber = Number(price);
    if (Number.isNaN(priceNumber) || priceNumber < 0) {
      setError("Enter the price per person in dollars, e.g. 30 or 32.50.");
      return;
    }
    const times = timesText
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      const payload = {
        name,
        location,
        tagline,
        description,
        durationMinutes: Number(duration),
        capacity: Number(capacity),
        priceCents: Math.round(priceNumber * 100),
        times,
        badgeBg: COLOR_PRESETS[colorIdx].bg,
        badgeFg: COLOR_PRESETS[colorIdx].fg,
        active,
      };
      const res = await fetch(initial ? `/api/manager/experiences/${initial.id}` : "/api/manager/experiences", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save. Please try again.");
      router.push("/manager/experiences?saved=1");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Please try again.");
      setSaving(false);
    }
  }

  return (
    <form className="form-card mgr-form" onSubmit={save} noValidate>
      {error && <div className="error-banner">{error}</div>}

      <h3>Basics</h3>
      <div className="field-row">
        <div className="field">
          <label htmlFor="name">
            Name <span className="req">*</span>
          </label>
          <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="location">
            Location <span className="req">*</span>
          </label>
          <input
            id="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Downtown location"
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="tagline">Tagline</label>
        <input
          id="tagline"
          type="text"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder={name ? `Book ${name}.` : "Shown under the name on the booking site"}
        />
      </div>
      <div className="field">
        <label htmlFor="description">
          Description <span className="req">*</span>
        </label>
        <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <h3>Sessions &amp; pricing</h3>
      <div className="field-row-3">
        <div className="field">
          <label htmlFor="price">
            Price per person ($) <span className="req">*</span>
          </label>
          <input id="price" type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="duration">
            Duration (minutes) <span className="req">*</span>
          </label>
          <input
            id="duration"
            type="text"
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="capacity">
            Capacity (max guests) <span className="req">*</span>
          </label>
          <input
            id="capacity"
            type="text"
            inputMode="numeric"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="times">
          Daily start times <span className="req">*</span>
        </label>
        <input id="times" type="text" value={timesText} onChange={(e) => setTimesText(e.target.value)} />
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>
          24-hour times separated by commas, e.g. <strong>10:00, 13:30, 19:00</strong>. These run every day.
        </p>
      </div>

      <h3>Appearance</h3>
      <div className="field">
        <label>Badge colour</label>
        <div className="mgr-swatches">
          {COLOR_PRESETS.map((p, i) => (
            <button
              key={p.bg}
              type="button"
              className={`mgr-swatch${i === colorIdx ? " selected" : ""}`}
              style={{ background: p.bg, color: p.fg }}
              onClick={() => setColorIdx(i)}
              aria-label={`${p.name}${i === colorIdx ? " (selected)" : ""}`}
              title={p.name}
            >
              Aa
            </button>
          ))}
        </div>
      </div>

      <label className="checkbox-row">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>Visible and bookable on the booking site</span>
      </label>

      <div className="form-actions">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Saving…" : initial ? "Save changes" : "Create experience"}
        </button>
      </div>
    </form>
  );
}
