import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { listLocationHours, upsertLocationHours } from "@/lib/hours";
import { toMinutes } from "@/lib/schedule";
import type { DayHours } from "@/lib/types";

export const dynamic = "force-dynamic";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// All locations' hours as a map, for the experience form's read-only preview.
export async function GET() {
  const guard = await apiGuard("settings");
  if (guard.response) return guard.response;
  try {
    const all = await listLocationHours();
    const hours: Record<string, Record<string, DayHours>> = {};
    for (const h of all) hours[h.location] = h.hours;
    return NextResponse.json({ hours });
  } catch (err) {
    console.error("loading store hours failed:", err);
    return NextResponse.json({ error: "Could not load store hours." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard("settings");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const d = body as { location?: unknown; hours?: unknown };

  const location = typeof d.location === "string" ? d.location.trim() : "";
  if (!location) return NextResponse.json({ error: "Missing location." }, { status: 400 });

  if (!d.hours || typeof d.hours !== "object") {
    return NextResponse.json({ error: "Missing hours." }, { status: 400 });
  }

  const hours: Record<string, DayHours> = {};
  for (const [k, v] of Object.entries(d.hours as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(k)) continue;
    const dh = v as { open?: unknown; close?: unknown; closed?: unknown };
    if (dh?.closed === true) {
      hours[k] = { open: "10:00", close: "22:00", closed: true };
      continue;
    }
    const open = typeof dh?.open === "string" && TIME_RE.test(dh.open) ? dh.open : null;
    const close = typeof dh?.close === "string" && TIME_RE.test(dh.close) ? dh.close : null;
    if (!open || !close) {
      return NextResponse.json({ error: "Enter valid open and close times, or mark the day closed." }, { status: 400 });
    }
    if (toMinutes(close) <= toMinutes(open)) {
      return NextResponse.json({ error: "Closing time must be after opening time." }, { status: 400 });
    }
    hours[k] = { open, close, closed: false };
  }

  try {
    await upsertLocationHours(location, hours);
    await logActivity("Updated store hours", location);
    return NextResponse.json({ location });
  } catch (err) {
    console.error("saving store hours failed:", err);
    return NextResponse.json({ error: "Could not save the hours right now. Please try again." }, { status: 500 });
  }
}
