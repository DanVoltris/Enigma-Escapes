"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ImageUpload from "@/components/manager/ImageUpload";
import LocationPicker from "@/components/manager/LocationPicker";
import TimesEditor from "@/components/manager/TimesEditor";
import WeekEditor, { type WeekValue } from "@/components/manager/WeekEditor";
import type { Experience, ScheduleMode, Windows } from "@/lib/types";

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

const DEFAULT_TIMES = ["10:00", "11:30", "13:00", "14:30", "16:00", "17:30", "19:00", "20:30"];

// Default weekly window: open 10:00–20:00 (last start) every day.
const DEFAULT_WEEK: WeekValue = Object.fromEntries(
  Array.from({ length: 7 }, (_, d) => [String(d), { start: "10:00", end: "20:00", closed: false }])
);

function windowsToWeek(windows: Windows): WeekValue {
  const w: WeekValue = { ...DEFAULT_WEEK };
  for (const [k, v] of Object.entries(windows)) {
    w[k] = { start: v.first, end: v.last, closed: v.closed };
  }
  return w;
}

function weekToWindows(week: WeekValue): Windows {
  const out: Windows = {};
  for (const [k, v] of Object.entries(week)) {
    out[k] = { first: v.start, last: v.end, closed: v.closed };
  }
  return out;
}

export default function ExperienceForm({
  initial,
  locations = [],
}: {
  initial?: Experience;
  locations?: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [location, setLocation] = useState(initial?.location ?? locations[0] ?? "");
  const [tagline, setTagline] = useState(initial?.tagline ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [duration, setDuration] = useState(String(initial?.durationMinutes ?? 60));
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? 10));
  const [price, setPrice] = useState(initial ? (initial.priceCents / 100).toFixed(2) : "30.00");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(initial?.scheduleMode ?? "times");
  const [times, setTimes] = useState<string[]>(initial?.times?.length ? initial.times : DEFAULT_TIMES);
  const [interval, setInterval] = useState(String(initial?.intervalMinutes ?? 75));
  const [week, setWeek] = useState<WeekValue>(initial?.windows ? windowsToWeek(initial.windows) : DEFAULT_WEEK);
  const [colorIdx, setColorIdx] = useState(() => {
    const found = COLOR_PRESETS.findIndex((p) => p.bg.toLowerCase() === (initial?.badgeBg ?? "").toLowerCase());
    return found >= 0 ? found : 0;
  });
  const [posterMode, setPosterMode] = useState<"colour" | "image">(initial?.imageUrl ? "image" : "colour");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
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
    if (scheduleMode === "times" && times.length === 0) {
      setError("Add at least one daily start time.");
      return;
    }
    if (posterMode === "image" && !imageUrl) {
      setError("Upload a poster image, or switch to a colour poster.");
      return;
    }

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
        scheduleMode,
        times: scheduleMode === "times" ? times : [],
        intervalMinutes: Number(interval),
        windows: scheduleMode === "window" ? weekToWindows(week) : {},
        badgeBg: COLOR_PRESETS[colorIdx].bg,
        badgeFg: COLOR_PRESETS[colorIdx].fg,
        imageUrl: posterMode === "image" ? imageUrl : null,
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
          <label>
            Location <span className="req">*</span>
          </label>
          <LocationPicker value={location} onChange={setLocation} locations={locations} />
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
        <label>
          When can people book? <span className="req">*</span>
        </label>
        <div className="pay-options" style={{ marginBottom: 16 }}>
          <label className={`pay-option ${scheduleMode === "times" ? "selected" : ""}`}>
            <input type="radio" checked={scheduleMode === "times"} onChange={() => setScheduleMode("times")} />
            <span>Specific times — I list the exact start times</span>
          </label>
          <label className={`pay-option ${scheduleMode === "window" ? "selected" : ""}`}>
            <input type="radio" checked={scheduleMode === "window"} onChange={() => setScheduleMode("window")} />
            <span>Daily window — a first and last start per weekday</span>
          </label>
          <label className={`pay-option ${scheduleMode === "store" ? "selected" : ""}`}>
            <input type="radio" checked={scheduleMode === "store"} onChange={() => setScheduleMode("store")} />
            <span>Follow store hours — starts run until closing minus the game length</span>
          </label>
        </div>

        {scheduleMode === "times" && <TimesEditor value={times} onChange={setTimes} />}

        {scheduleMode !== "times" && (
          <div className="field" style={{ maxWidth: 260 }}>
            <label htmlFor="interval">Minutes between start times</label>
            <input
              id="interval"
              type="text"
              inputMode="numeric"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            />
          </div>
        )}

        {scheduleMode === "window" && (
          <WeekEditor value={week} onChange={setWeek} startLabel="First start" endLabel="Last start" />
        )}

        {scheduleMode === "store" && (
          <p style={{ fontSize: 14, color: "var(--text-secondary)", background: "var(--accent-tint)", padding: "12px 14px", border: "1px solid var(--border)" }}>
            Start times are generated from <strong>{location || "this location"}</strong>&apos;s opening hours, up to
            closing time minus the {duration}-minute game length. Set the opening hours on the{" "}
            <strong>Store hours</strong> tab.
          </p>
        )}
      </div>

      <h3>Poster</h3>
      <p style={{ color: "var(--text-secondary)", marginBottom: 14, marginTop: -8 }}>
        Choose how this experience looks on the booking site — a colour block or an uploaded image.
      </p>
      <div className="pay-options" style={{ marginBottom: 18 }}>
        <label className={`pay-option ${posterMode === "colour" ? "selected" : ""}`}>
          <input type="radio" checked={posterMode === "colour"} onChange={() => setPosterMode("colour")} />
          <span>Colour block</span>
        </label>
        <label className={`pay-option ${posterMode === "image" ? "selected" : ""}`}>
          <input type="radio" checked={posterMode === "image"} onChange={() => setPosterMode("image")} />
          <span>Uploaded image</span>
        </label>
      </div>

      {posterMode === "colour" ? (
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
      ) : (
        <div className="field">
          <label>Poster image</label>
          <ImageUpload value={imageUrl} onChange={setImageUrl} />
        </div>
      )}

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
