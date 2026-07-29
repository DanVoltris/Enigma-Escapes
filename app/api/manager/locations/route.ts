import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/db";
import { listAllLocations, upsertLocationHours } from "@/lib/hours";
import type { DayHours } from "@/lib/types";

export const dynamic = "force-dynamic";

// Add a location directly (before any experience uses it). It gets a
// location_hours row with sensible default hours staff adjust right away.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const name = typeof (body as { name?: unknown }).name === "string" ? (body as { name: string }).name.trim() : "";
  if (!name) return NextResponse.json({ error: "Give the location a name, e.g. Downtown." }, { status: 400 });
  if (name.length > 60) return NextResponse.json({ error: "Keep the location name under 60 characters." }, { status: 400 });

  const existing = await listAllLocations();
  if (existing.some((l) => l.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: `“${name}” already exists.` }, { status: 400 });
  }

  const defaults: Record<string, DayHours> = Object.fromEntries(
    ["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, { open: "09:00", close: "22:00", closed: false }])
  );
  try {
    await upsertLocationHours(name, defaults);
    await logActivity("Location added", name);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("adding location failed:", err);
    return NextResponse.json({ error: "Could not add the location right now. Please try again." }, { status: 500 });
  }
}
