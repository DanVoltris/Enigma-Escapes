import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { deploymentTimezone } from "@/lib/format";
import { normalizeLocale } from "@/lib/locale-options";
import { saveSetting } from "@/lib/settings";

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

  // normalizeLocale drops anything not in the allowed option lists, so we only
  // ever store valid values. A deployment-fixed timezone is stored as-is, so the
  // setting can never disagree with the clock the server actually runs on.
  const fixed = deploymentTimezone();
  const locale = fixed ? { ...normalizeLocale(body), timezone: fixed } : normalizeLocale(body);

  try {
    await saveSetting("locale", locale);
    await logActivity("Updated locale settings", `${locale.currencyCode} · ${locale.timezone} · ${locale.timeFormat}h`);
    return NextResponse.json({ ok: true, locale });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save right now. Please try again.";
    console.error("saving locale failed:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
