"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ImageUpload from "@/components/manager/ImageUpload";
import LocationPicker from "@/components/manager/LocationPicker";
import TimesEditor from "@/components/manager/TimesEditor";
import WeekEditor, { type WeekValue } from "@/components/manager/WeekEditor";
import type { DayHours, Experience, ScheduleMode, Windows } from "@/lib/types";

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

// Store hours shown (read-only) in the grid while following them. Days without
// hours, or marked closed, show as closed.
function hoursToDisplayWeek(hours?: Record<string, DayHours>): WeekValue {
  const w: WeekValue = {};
  for (let d = 0; d < 7; d++) {
    const h = hours?.[String(d)];
    w[String(d)] = h && !h.closed ? { start: h.open, end: h.close, closed: false } : { start: "10:00", end: "22:00", closed: true };
  }
  return w;
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
  const [minParty, setMinParty] = useState(String(initial?.minParty ?? 4));
  const [maxParty, setMaxParty] = useState(String(initial?.maxParty ?? initial?.capacity ?? 10));
  const [isPrivate, setIsPrivate] = useState(initial?.isPrivate ?? false);
  const [depositPercent, setDepositPercent] = useState(String(initial?.depositPercent ?? 25));
  // Two visible choices: an opening-hours window (which can follow store hours),
  // and a specific list of times. Internally these map to the three schedule
  // modes: follow-store-hours = "store", custom window = "window", list = "times".
  const [scheduleKind, setScheduleKind] = useState<"opening" | "times">(
    initial?.scheduleMode === "times" ? "times" : "opening"
  );
  const [followStoreHours, setFollowStoreHours] = useState<boolean>(initial?.scheduleMode !== "window");
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

  // Store hours per location, for the read-only preview shown while a room
  // follows store hours.
  const [locationHours, setLocationHours] = useState<Record<string, Record<string, DayHours>>>({});
  useEffect(() => {
    fetch("/api/manager/hours")
      .then((r) => r.json())
      .then((d) => setLocationHours(d.hours ?? {}))
      .catch(() => {});
  }, []);
  const hoursForLocation = locationHours[location];
  const hasHours = !!hoursForLocation && Object.keys(hoursForLocation).length > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const priceNumber = Number(price);
    if (Number.isNaN(priceNumber) || priceNumber < 0) {
      setError("Enter the price per person in dollars, e.g. 30 or 32.50.");
      return;
    }
    if (scheduleKind === "times" && times.length === 0) {
      setError("Add at least one daily start time.");
      return;
    }
    if (posterMode === "image" && !imageUrl) {
      setError("Upload a poster image, or switch to a colour poster.");
      return;
    }

    const scheduleMode: ScheduleMode =
      scheduleKind === "times" ? "times" : followStoreHours ? "store" : "window";

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
        minParty: Number(minParty),
        maxParty: Number(maxParty),
        private: isPrivate,
        depositPercent: Number(depositPercent),
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

      <div className="field-row-3">
        <div className="field">
          <label htmlFor="minParty">
            Min guests per booking <span className="req">*</span>
          </label>
          <input
            id="minParty"
            type="text"
            inputMode="numeric"
            value={minParty}
            onChange={(e) => setMinParty(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="maxParty">
            Max guests per booking <span className="req">*</span>
          </label>
          <input
            id="maxParty"
            type="text"
            inputMode="numeric"
            value={maxParty}
            onChange={(e) => setMaxParty(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Booking type</label>
          <label className="checkbox-row" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            <span>
              Private — one booking per time slot (the whole game is exclusive to a single group, instead of filling
              to capacity with several parties).
            </span>
          </label>
        </div>
      </div>

      <div className="field" style={{ maxWidth: 340 }}>
        <label htmlFor="deposit">
          Deposit required (%) <span className="req">*</span>
        </label>
        <input
          id="deposit"
          type="text"
          inputMode="decimal"
          value={depositPercent}
          onChange={(e) => setDepositPercent(e.target.value)}
        />
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 6 }}>
          The share customers pay online now; the rest is collected at the venue. Set to 100 to require full payment
          up front.
        </p>
      </div>

      <div className="field">
        <label>
          When can people book? <span className="req">*</span>
        </label>
        <div className="pay-options" style={{ marginBottom: 16 }}>
          <label className={`pay-option ${scheduleKind === "opening" ? "selected" : ""}`}>
            <input type="radio" checked={scheduleKind === "opening"} onChange={() => setScheduleKind("opening")} />
            <span>Daily window — start times generated through the day</span>
          </label>
          <label className={`pay-option ${scheduleKind === "times" ? "selected" : ""}`}>
            <input type="radio" checked={scheduleKind === "times"} onChange={() => setScheduleKind("times")} />
            <span>Specific times — I list the exact start times</span>
          </label>
        </div>

        {scheduleKind === "opening" && (
          <>
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

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={followStoreHours}
                onChange={(e) => setFollowStoreHours(e.target.checked)}
              />
              <span>
                Follow store hours — generate starts from <strong>{location || "this location"}</strong>&apos;s
                opening hours, up to closing minus the {duration}-minute game length. Uncheck to set your own window
                per day below.
              </span>
            </label>

            {followStoreHours ? (
              <>
                {hasHours ? (
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
                    Showing <strong>{location}</strong>&apos;s store hours (change them on the <strong>Settings → Store hours</strong>{" "}
                    tab). The last start each day is closing minus the {duration}-minute game.
                  </p>
                ) : (
                  <p
                    style={{
                      fontSize: 14,
                      color: "var(--text-secondary)",
                      background: "var(--accent-tint)",
                      padding: "12px 14px",
                      border: "1px solid var(--border)",
                      marginBottom: 12,
                    }}
                  >
                    No store hours set for <strong>{location || "this location"}</strong> yet. Set them on the{" "}
                    <strong>Settings → Store hours</strong> tab, or uncheck &ldquo;Follow store hours&rdquo; to set a window here.
                  </p>
                )}
                <div style={{ opacity: 0.55, pointerEvents: "none" }} aria-disabled="true">
                  <WeekEditor
                    value={hoursToDisplayWeek(hoursForLocation)}
                    onChange={() => {}}
                    startLabel="Opens"
                    endLabel="Closes"
                  />
                </div>
              </>
            ) : (
              <WeekEditor value={week} onChange={setWeek} startLabel="First start" endLabel="Last start" />
            )}
          </>
        )}

        {scheduleKind === "times" && <TimesEditor value={times} onChange={setTimes} />}
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
