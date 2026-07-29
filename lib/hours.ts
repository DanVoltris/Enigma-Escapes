import { rest, restError } from "./supabase";
import type { DayHours, LocationHours } from "./types";

type HoursRow = { location: string; hours: Record<string, DayHours> };

export async function listLocationHours(): Promise<LocationHours[]> {
  const res = await rest("location_hours?select=*");
  if (!res.ok) throw await restError(res, "Loading store hours");
  return ((await res.json()) as HoursRow[]).map((r) => ({ location: r.location, hours: r.hours ?? {} }));
}

export async function getLocationHours(location: string): Promise<LocationHours | null> {
  const res = await rest(`location_hours?location=eq.${encodeURIComponent(location)}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Loading store hours");
  const rows = (await res.json()) as HoursRow[];
  return rows[0] ? { location: rows[0].location, hours: rows[0].hours ?? {} } : null;
}

// Every known location: ones used by experiences plus ones added directly on
// Locations & hours (a location_hours row with no experiences yet).
export async function listAllLocations(): Promise<string[]> {
  const { listLocations } = await import("./experiences");
  const [fromExperiences, hoursRows] = await Promise.all([listLocations(), listLocationHours()]);
  const out = [...fromExperiences];
  for (const h of hoursRows) if (!out.includes(h.location)) out.push(h.location);
  return out;
}

// A map of location → hours, for computing availability across many experiences.
export async function locationHoursMap(): Promise<Map<string, LocationHours>> {
  const all = await listLocationHours();
  return new Map(all.map((h) => [h.location, h]));
}

export async function upsertLocationHours(location: string, hours: Record<string, DayHours>): Promise<void> {
  const res = await rest("location_hours", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ location, hours }),
  });
  if (!res.ok) throw await restError(res, "Saving store hours");
}
