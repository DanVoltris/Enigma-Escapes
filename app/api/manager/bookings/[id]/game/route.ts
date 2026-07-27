import { NextRequest, NextResponse } from "next/server";
import { getBooking, logActivity, saveGameResult } from "@/lib/db";
import type { GameResult } from "@/lib/types";

export const dynamic = "force-dynamic";

// Staff record how a session went (escaped, time left, hints). PUT replaces
// any earlier result — games get re-recorded when staff mistype.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  if (typeof o.escaped !== "boolean") {
    return NextResponse.json({ error: "Say whether the group escaped." }, { status: 400 });
  }
  const intOrNull = (v: unknown, max: number): number | null | undefined => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
  };
  const timeRemainingMinutes = intOrNull(o.timeRemainingMinutes, 240);
  if (timeRemainingMinutes === undefined) {
    return NextResponse.json({ error: "Time remaining must be whole minutes between 0 and 240." }, { status: 400 });
  }
  const hintsUsed = intOrNull(o.hintsUsed, 99);
  if (hintsUsed === undefined) {
    return NextResponse.json({ error: "Hints used must be a whole number between 0 and 99." }, { status: 400 });
  }
  const notes = typeof o.notes === "string" ? o.notes.trim().slice(0, 500) : "";

  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });

  const result: GameResult = {
    escaped: o.escaped,
    timeRemainingMinutes,
    hintsUsed,
    notes,
    recordedAt: new Date().toISOString(),
  };

  try {
    await saveGameResult(id, result);
    await logActivity(
      "Game result recorded",
      `${booking.reference} — ${result.escaped ? "escaped" : "did not escape"}`
    );
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("saving game result failed:", err);
    return NextResponse.json({ error: "Could not save the result right now. Please try again." }, { status: 500 });
  }
}
