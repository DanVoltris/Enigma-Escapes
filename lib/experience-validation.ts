import { MIN_PARTY_SIZE } from "./pricing";
import type { Experience } from "./types";

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
  if (!Number.isInteger(capacity) || capacity < MIN_PARTY_SIZE || capacity > 50) {
    return { error: `Capacity must be between ${MIN_PARTY_SIZE} (the minimum party size) and 50.` };
  }

  const priceCents = Number(d.priceCents);
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100000) {
    return { error: "Price per person must be between $0 and $1000." };
  }

  if (!Array.isArray(d.times) || d.times.length === 0) {
    return { error: "Add at least one daily start time, e.g. 10:00 or 19:30." };
  }
  const times: string[] = [];
  for (const t of d.times) {
    if (typeof t !== "string" || !TIME_RE.test(t)) {
      return { error: `"${String(t)}" is not a valid time. Use 24-hour HH:MM, e.g. 09:30 or 19:00.` };
    }
    if (!times.includes(t)) times.push(t);
  }
  times.sort();
  if (times.length > 24) return { error: "That's too many start times — keep it to 24 per day." };

  const badgeBg = typeof d.badgeBg === "string" && HEX_RE.test(d.badgeBg) ? d.badgeBg : "#0B2540";
  const badgeFg = typeof d.badgeFg === "string" && HEX_RE.test(d.badgeFg) ? d.badgeFg : "#FFFFFF";

  return {
    name,
    location,
    tagline,
    description,
    durationMinutes,
    capacity,
    priceCents,
    times,
    badgeBg,
    badgeFg,
    active: d.active !== false,
  };
}
