import { rest, restError } from "./supabase";
import type { Experience } from "./types";

type ExperienceRow = {
  id: string;
  name: string;
  location: string;
  tagline: string;
  description: string;
  duration_minutes: number;
  capacity: number;
  price_cents: number;
  times: string[];
  badge_bg: string;
  badge_fg: string;
  image_url: string | null;
  active: boolean;
  sort: number;
};

function toExperience(row: ExperienceRow): Experience {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    tagline: row.tagline,
    description: row.description,
    durationMinutes: row.duration_minutes,
    capacity: row.capacity,
    priceCents: row.price_cents,
    times: row.times,
    badgeBg: row.badge_bg,
    badgeFg: row.badge_fg,
    imageUrl: row.image_url ?? null,
    active: row.active,
    sort: row.sort,
  };
}

function toRow(e: Omit<Experience, "id"> & { id?: string }): Omit<ExperienceRow, "id"> & { id?: string } {
  return {
    ...(e.id ? { id: e.id } : {}),
    name: e.name,
    location: e.location,
    tagline: e.tagline,
    description: e.description,
    duration_minutes: e.durationMinutes,
    capacity: e.capacity,
    price_cents: e.priceCents,
    times: e.times,
    badge_bg: e.badgeBg,
    badge_fg: e.badgeFg,
    image_url: e.imageUrl,
    active: e.active,
    sort: e.sort,
  };
}

export async function listExperiences(opts?: { activeOnly?: boolean }): Promise<Experience[]> {
  const filter = opts?.activeOnly ? "&active=is.true" : "";
  const res = await rest(`experiences?select=*${filter}&order=sort.asc,name.asc`);
  if (!res.ok) throw await restError(res, "Loading experiences");
  return ((await res.json()) as ExperienceRow[]).map(toExperience);
}

// Distinct location names across all experiences, in first-seen order.
export async function listLocations(): Promise<string[]> {
  const experiences = await listExperiences();
  return experiences.reduce<string[]>((acc, e) => {
    if (!acc.includes(e.location)) acc.push(e.location);
    return acc;
  }, []);
}

export async function getExperience(id: string): Promise<Experience | undefined> {
  const res = await rest(`experiences?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Loading the experience");
  const rows = (await res.json()) as ExperienceRow[];
  return rows[0] ? toExperience(rows[0]) : undefined;
}

export async function createExperience(e: Experience): Promise<void> {
  const res = await rest("experiences", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(toRow(e)),
  });
  if (!res.ok) throw await restError(res, "Creating the experience");
}

export async function updateExperience(id: string, patch: Partial<Experience>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.location !== undefined) row.location = patch.location;
  if (patch.tagline !== undefined) row.tagline = patch.tagline;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.durationMinutes !== undefined) row.duration_minutes = patch.durationMinutes;
  if (patch.capacity !== undefined) row.capacity = patch.capacity;
  if (patch.priceCents !== undefined) row.price_cents = patch.priceCents;
  if (patch.times !== undefined) row.times = patch.times;
  if (patch.badgeBg !== undefined) row.badge_bg = patch.badgeBg;
  if (patch.badgeFg !== undefined) row.badge_fg = patch.badgeFg;
  if (patch.imageUrl !== undefined) row.image_url = patch.imageUrl;
  if (patch.active !== undefined) row.active = patch.active;
  if (patch.sort !== undefined) row.sort = patch.sort;
  const res = await rest(`experiences?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw await restError(res, "Updating the experience");
}
