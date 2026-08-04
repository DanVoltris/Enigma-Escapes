import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { listReaders, terminalConfigured } from "@/lib/stripe-terminal";
import { getReaderMap, saveReaderMap } from "@/lib/terminal-settings";

export const dynamic = "force-dynamic";

// Readers on the Stripe account + which venue each is paired with.
export async function GET() {
  const guard = await apiGuard("settings");
  if (guard.response) return guard.response;
  const map = await getReaderMap();
  if (!terminalConfigured()) return NextResponse.json({ configured: false, readers: [], map });
  try {
    return NextResponse.json({ configured: true, readers: await listReaders(), map });
  } catch (err) {
    console.error("listing readers failed:", err);
    return NextResponse.json({ configured: true, readers: [], map, error: "Could not reach Stripe." });
  }
}

// Pair (or unpair) a venue with a reader.
export async function PUT(req: NextRequest) {
  const guard = await apiGuard("settings");
  if (guard.response) return guard.response;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const location = typeof o.location === "string" ? o.location.trim() : "";
  const readerId = typeof o.readerId === "string" ? o.readerId.trim() : "";
  if (!location) return NextResponse.json({ error: "Which location?" }, { status: 400 });

  try {
    const map = await getReaderMap();
    if (readerId) map[location] = readerId;
    else delete map[location];
    await saveReaderMap(map);
    await logActivity("Card reader paired", `${location} → ${readerId || "none"}`);
    return NextResponse.json({ ok: true, map });
  } catch (err) {
    console.error("pairing reader failed:", err);
    return NextResponse.json({ error: "Could not save that pairing. Please try again." }, { status: 500 });
  }
}
