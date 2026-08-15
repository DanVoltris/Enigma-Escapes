import { listBookings, listBookingsInWindow } from "./db";
import { addDaysISO, todayISO } from "./format";
import { rest, restError } from "./supabase";
import type { Experience } from "./types";

import type { ScheduleMode, Windows } from "./types";

type ExperienceRow = {
  id: string;
  name: string;
  location: string;
  tagline: string;
  description: string;
  duration_minutes: number;
  capacity: number;
  price_cents: number;
  min_party: number;
  max_party: number;
  private: boolean;
  deposit_percent: number | string;
  schedule_mode: ScheduleMode;
  times: string[];
  interval_minutes: number;
  windows: Windows;
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
    minParty: row.min_party ?? 4,
    maxParty: row.max_party ?? row.capacity,
    isPrivate: row.private ?? false,
    depositPercent: row.deposit_percent != null ? Number(row.deposit_percent) : 25,
    scheduleMode: row.schedule_mode ?? "times",
    times: row.times ?? [],
    intervalMinutes: row.interval_minutes ?? 75,
    windows: row.windows ?? {},
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
    min_party: e.minParty,
    max_party: e.maxParty,
    private: e.isPrivate,
    deposit_percent: e.depositPercent,
    schedule_mode: e.scheduleMode,
    times: e.times,
    interval_minutes: e.intervalMinutes,
    windows: e.windows,
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
  if (patch.minParty !== undefined) row.min_party = patch.minParty;
  if (patch.maxParty !== undefined) row.max_party = patch.maxParty;
  if (patch.isPrivate !== undefined) row.private = patch.isPrivate;
  if (patch.depositPercent !== undefined) row.deposit_percent = patch.depositPercent;
  if (patch.scheduleMode !== undefined) row.schedule_mode = patch.scheduleMode;
  if (patch.intervalMinutes !== undefined) row.interval_minutes = patch.intervalMinutes;
  if (patch.windows !== undefined) row.windows = patch.windows;
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

// What a room has behind it, which is what decides whether deleting it is a
// tidy-up or a mistake. Counted rather than guessed: every real room here has
// thousands of sessions and one confirm dialog is all that stands in front of
// them.
//
// `total` comes back as a count with no rows attached — the number is the whole
// question, and six years of history is not worth moving to answer it.
export type UpcomingSession = {
  bookingId: string;
  reference: string;
  date: string;
  time: string;
  guests: number;
  customer: string;
};

export type ExperienceUsage = {
  total: number;
  upcoming: number;
  // The soonest of the upcoming ones, so "move or cancel them first" comes with
  // the list of what to move — a count alone leaves staff hunting the calendar.
  nextSessions: UpcomingSession[];
};

const SESSIONS_SHOWN = 8;

export async function experienceUsage(id: string): Promise<ExperienceUsage> {
  const contains = encodeURIComponent(JSON.stringify([{ roomId: id }]));
  const res = await rest(`bookings?items=cs.${contains}&select=id&limit=1`, {
    headers: { Prefer: "count=exact" },
  });
  if (!res.ok) throw await restError(res, "Counting the room's bookings");
  const total = Number((res.headers.get("content-range") ?? "/0").split("/")[1]) || 0;

  // Sessions still to come are the ones that make a delete an operational
  // problem rather than a housekeeping one, so they're counted separately.
  // The window function is the cheap path; where it isn't installed (and in
  // local-data mode) fall back to the full list rather than reporting zero —
  // "nothing is booked" is the answer that unlocks the delete, so it has to be
  // a real answer.
  const today = todayISO();
  const ahead = (await listBookingsInWindow(today, addDaysISO(today, 730))) ?? (await listBookings());
  const sessions = ahead
    .flatMap((b) =>
      b.items
        .filter((i) => i.roomId === id && i.date >= today)
        .map((i) => ({
          bookingId: b.id,
          reference: b.reference,
          date: i.date,
          time: i.time,
          guests: i.quantity,
          customer: `${b.customer.firstName} ${b.customer.lastName}`.trim(),
        }))
    )
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  return { total, upcoming: sessions.length, nextSessions: sessions.slice(0, SESSIONS_SHOWN) };
}

export async function deleteExperience(id: string): Promise<void> {
  const res = await rest(`experiences?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok) throw await restError(res, "Deleting the experience");
}
