import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { saveSetting } from "@/lib/settings";
import { normalizeSiteSettings } from "@/lib/site-settings";
import { publicImageBase } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const guard = await apiGuard("settings");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const settings = normalizeSiteSettings(body); // clamps numbers, validates hex colours

  // Only accept a logo URL our own upload endpoint produced (same guard as
  // experience images); arbitrary external URLs are dropped.
  if (settings.logoUrl && !settings.logoUrl.startsWith(publicImageBase())) settings.logoUrl = null;

  try {
    await saveSetting("booking_site", settings);
    await logActivity(
      "Updated booking site settings",
      `${settings.windowDays} days ahead, ${settings.holdMinutes} min basket hold`
    );
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save right now. Please try again.";
    console.error("saving booking site settings failed:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
