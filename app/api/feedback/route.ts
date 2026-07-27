import { NextRequest, NextResponse } from "next/server";
import { getBookingByReference, logActivity } from "@/lib/db";
import { saveFeedback } from "@/lib/feedback";

export const dynamic = "force-dynamic";

// Public survey submission. The reference must belong to a real booking —
// that's the anti-spam gate — and one response per booking (overwrites).
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  const reference = typeof o.reference === "string" ? o.reference.trim().toUpperCase() : "";
  const rating = typeof o.rating === "number" ? o.rating : Number(o.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Pick a rating from 1 to 5." }, { status: 400 });
  }
  const comment = typeof o.comment === "string" ? o.comment.trim().slice(0, 1000) : "";
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 100) : "";

  const booking = await getBookingByReference(reference).catch(() => undefined);
  if (!booking) {
    return NextResponse.json(
      { error: "That booking reference wasn't found — check it against your confirmation (e.g. VB-AB12CD)." },
      { status: 400 }
    );
  }

  try {
    await saveFeedback({ reference: booking.reference, rating, comment, name, createdAt: new Date().toISOString() });
    await logActivity("Survey received", `${booking.reference} — ${rating}/5`);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("saving feedback failed:", err);
    return NextResponse.json({ error: "Could not save your feedback right now. Please try again." }, { status: 500 });
  }
}
