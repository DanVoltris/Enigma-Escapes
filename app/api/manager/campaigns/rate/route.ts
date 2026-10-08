import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { normalizeRateCents, saveSmsRateCents } from "@/lib/sms-rate";

export const dynamic = "force-dynamic";

// What this venue pays Twilio for one text. Only ever used for the estimate on
// the composer, so a wrong figure costs nobody anything but a surprise.
export async function PUT(req: NextRequest) {
  const guard = await apiGuard("marketing");
  if (guard.response) return guard.response;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const cents = Number(o.centsPerSegment);
  if (!Number.isFinite(cents) || cents <= 0 || cents > 50) {
    return NextResponse.json({ error: "Enter the price of one text in cents, e.g. 1.7." }, { status: 400 });
  }
  try {
    await saveSmsRateCents(normalizeRateCents(cents));
    return NextResponse.json({ ok: true, centsPerSegment: normalizeRateCents(cents) });
  } catch (err) {
    console.error("saving the text rate failed:", err);
    return NextResponse.json({ error: "Could not save that right now." }, { status: 500 });
  }
}
