import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/db";
import { normalizeLocale } from "@/lib/locale-options";
import { saveSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // normalizeLocale drops anything not in the allowed option lists, so we only
  // ever store valid values.
  const locale = normalizeLocale(body);

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
