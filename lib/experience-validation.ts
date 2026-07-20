import { MIN_PARTY_SIZE } from "./pricing";
import { toMinutes, WEEKDAY_NAMES } from "./schedule";
import { publicImageBase } from "./storage";
import type { Experience, ScheduleMode, Windows } from "./types";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export type ExperienceInput = Omit<Experience, "id" | "sort"> & { sort?: number };

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Returns a clean ExperienceInput or a plain-language error message.
export function parseExperienceInput(raw: unknown): ExperienceInput | { error: string } {
  const d = raw as Record<string, unknown>;

  const name = typeof d.name === "string" ? d.name.trim() : "";
  if (!name || name.length > 80) return { error: "Give the experience a name (up to 80 characters)." };

  const location = typeof d.location === "string" ? d.location.trim() : "";
  if (!location || location.length > 80) return { error: "Enter a location name (up to 80 characters)." };

  const tagline = typeof d.tagline === "string" && d.tagline.trim() ? d.tagline.trim() : `Book ${name}.`;
  if (tagline.length > 140) return { error: "Keep the tagline under 140 characters." };

  const description = typeof d.description === "string" ? d.description.trim() : "";
  if (!description || description.length > 2000) {
    return { error: "Write a description customers will see (up to 2000 characters)." };
  }

  const durationMinutes = Number(d.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) {
    return { error: "Duration must be between 15 and 240 minutes." };
  }

  const capacity = Number(d.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
    return { error: "Capacity must be between 1 and 50." };
  }

  const minParty = Number(d.minParty);
  if (!Number.isInteger(minParty) || minParty < 1 || minParty > capacity) {
    return { error: `Minimum guests per booking must be between 1 and the capacity (${capacity}).` };
  }
  const maxParty = Number(d.maxParty);
  if (!Number.isInteger(maxParty) || maxParty < minParty || maxParty > capacity) {
    return { error: `Maximum guests per booking must be between the minimum (${minParty}) and the capacity (${capacity}).` };
  }
  const isPrivate = d.private === true || d.isPrivate === true;

  const priceCents = Number(d.priceCents);
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100000) {
    return { error: "Price per person must be between $0 and $1000." };
  }

  const scheduleMode: ScheduleMode =
    d.scheduleMode === "window" ? "window" : d.scheduleMode === "store" ? "store" : "times";

  // Interval only matters for window/store modes; validate it there.
  const rawInterval = Number(d.intervalMinutes);
  const intervalMinutes = Number.isInteger(rawInterval) ? rawInterval : 75;
  if (scheduleMode !== "times" && (intervalMinutes < 15 || intervalMinutes > 240)) {
    return { error: "Time between sessions must be between 15 and 240 minutes." };
  }

  // "times" mode needs an explicit list; other modes generate times.
  const times: string[] = [];
  if (scheduleMode === "times") {
    if (!Array.isArray(d.times) || d.times.length === 0) {
      return { error: "Add at least one daily start time, e.g. 10:00 or 19:30." };
    }
    for (const t of d.times) {
      if (typeof t !== "string" || !TIME_RE.test(t)) {
        return { error: `"${String(t)}" is not a valid time. Use 24-hour HH:MM, e.g. 09:30 or 19:00.` };
      }
      if (!times.includes(t)) times.push(t);
    }
    times.sort();
    if (times.length > 24) return { error: "That's too many start times — keep it to 24 per day." };
  }

  // "window" mode needs a per-weekday first/last (or closed) with ≥1 open day.
  const windows: Windows = {};
  if (scheduleMode === "window") {
    const raw = d.windows;
    if (!raw || typeof raw !== "object") {
      return { error: "Set the opening days and times for the weekly window." };
    }
    let anyOpen = false;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^[0-6]$/.test(k)) continue;
      const dw = v as { first?: unknown; last?: unknown; closed?: unknown };
      if (dw?.closed === true) {
        windows[k] = { first: "10:00", last: "20:00", closed: true };
        continue;
      }
      const first = typeof dw?.first === "string" && TIME_RE.test(dw.first) ? dw.first : null;
      const last = typeof dw?.last === "string" && TIME_RE.test(dw.last) ? dw.last : null;
      if (!first || !last) {
        return { error: `${WEEKDAY_NAMES[Number(k)]}: enter a valid first and last start time, or mark it closed.` };
      }
      if (toMinutes(last) < toMinutes(first)) {
        return { error: `${WEEKDAY_NAMES[Number(k)]}: the last start can't be before the first.` };
      }
      windows[k] = { first, last, closed: false };
      anyOpen = true;
    }
    if (!anyOpen) return { error: "Open on at least one day, or use specific times instead." };
  }

  const badgeBg = typeof d.badgeBg === "string" && HEX_RE.test(d.badgeBg) ? d.badgeBg : "#0B2540";
  const badgeFg = typeof d.badgeFg === "string" && HEX_RE.test(d.badgeFg) ? d.badgeFg : "#FFFFFF";

  // Only accept an image URL we produced (from our storage bucket); anything
  // else — including arbitrary external URLs — is rejected as null.
  let imageUrl: string | null = null;
  if (typeof d.imageUrl === "string" && d.imageUrl.startsWith(publicImageBase())) {
    imageUrl = d.imageUrl;
  }

  return {
    name,
    location,
    tagline,
    description,
    durationMinutes,
    capacity,
    priceCents,
    minParty,
    maxParty,
    isPrivate,
    scheduleMode,
    times,
    intervalMinutes,
    windows,
    badgeBg,
    badgeFg,
    imageUrl,
    active: d.active !== false,
  };
}
