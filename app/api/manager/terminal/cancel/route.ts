import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { cancelIntent, cancelReaderAction, terminalConfigured } from "@/lib/stripe-terminal";

export const dynamic = "force-dynamic";

// Staff backed out: clear the reader's screen and void the pending payment.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  if (!terminalConfigured()) return NextResponse.json({ ok: true });

  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const readerId = typeof o.readerId === "string" ? o.readerId : "";
  const intentId = typeof o.intentId === "string" ? o.intentId : "";
  if (readerId) await cancelReaderAction(readerId);
  if (intentId) await cancelIntent(intentId);
  return NextResponse.json({ ok: true });
}
