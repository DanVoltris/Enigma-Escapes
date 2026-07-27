import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/db";
import { FB_PIXEL_RE, GTM_ID_RE, MEETING_URL_RE, normalizeIntegrations } from "@/lib/integrations";
import { saveSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // Reject clearly instead of silently disabling: an enabled tracker whose ID
  // doesn't validate is a mistake the owner should hear about.
  const raw = (body ?? {}) as Record<string, unknown>;
  const fbId = typeof raw.fbPixelId === "string" ? raw.fbPixelId.trim() : "";
  const gtmId = typeof raw.gtmId === "string" ? raw.gtmId.trim().toUpperCase() : "";
  if (raw.fbEnabled === true && !FB_PIXEL_RE.test(fbId)) {
    return NextResponse.json(
      { error: "Enter a valid Facebook Pixel ID (8–20 digits) or turn Facebook Tracking off." },
      { status: 400 }
    );
  }
  if (raw.gtmEnabled === true && !GTM_ID_RE.test(gtmId)) {
    return NextResponse.json(
      { error: "Enter a valid Google Tag Manager ID like GTM-ABC1234 or turn Google Tag Manager off." },
      { status: 400 }
    );
  }

  const zoomUrl = typeof raw.zoomUrl === "string" ? raw.zoomUrl.trim() : "";
  if (raw.zoomEnabled === true && !MEETING_URL_RE.test(zoomUrl)) {
    return NextResponse.json(
      { error: "Enter a valid https:// meeting link or turn the virtual game link off." },
      { status: 400 }
    );
  }

  const settings = normalizeIntegrations(body);

  try {
    await saveSetting("integrations", settings);
    const on = [settings.fbEnabled && "Facebook", settings.gtmEnabled && "GTM"].filter(Boolean).join(" + ") || "none";
    await logActivity("Updated integrations", `Active: ${on}`);
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save right now. Please try again.";
    console.error("saving integrations failed:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
