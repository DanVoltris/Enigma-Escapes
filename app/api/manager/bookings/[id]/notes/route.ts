import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { addBookingNote, getBooking, logActivity, updateBookingNote } from "@/lib/db";

export const dynamic = "force-dynamic";

// Staff notes on a booking — anything worth the next person knowing: a phone
// call about running late, an accessibility need, a card left behind.
//
// Notes carry who wrote them and when. Staff can rewrite their own (PATCH
// below stamps editedAt so a changed note still looks changed); the system's
// own entries, like the legacy-import trail, are not editable — a record that
// can be quietly rewritten is worth less than one that can't.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Write something first." }, { status: 400 });
  if (text.length > 1000) {
    return NextResponse.json({ error: "Notes are limited to 1000 characters." }, { status: 400 });
  }

  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });

  const saved = await addBookingNote(id, text, guard.staff.name);
  if (!saved) {
    return NextResponse.json({ error: "Could not save the note right now. Please try again." }, { status: 500 });
  }
  await logActivity("Booking note added", `${booking.reference} — by ${guard.staff.name}`);
  return NextResponse.json({ ok: true });
}

// Edit a note already written. Staff notes only — the system's own entries
// (the legacy-import trail) are refused by updateBookingNote.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const noteId = typeof raw.noteId === "string" ? raw.noteId : "";
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!noteId) return NextResponse.json({ error: "Which note?" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "A note can't be left empty." }, { status: 400 });
  if (text.length > 1000) {
    return NextResponse.json({ error: "Notes are limited to 1000 characters." }, { status: 400 });
  }

  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });

  const outcome = await updateBookingNote(id, noteId, text);
  if (outcome === "not-found") return NextResponse.json({ error: "That note no longer exists." }, { status: 404 });
  if (outcome === "protected") {
    return NextResponse.json({ error: "System notes can't be edited." }, { status: 403 });
  }
  if (outcome === "failed") {
    return NextResponse.json({ error: "Could not save the change right now. Please try again." }, { status: 500 });
  }
  await logActivity("Booking note edited", `${booking.reference} — by ${guard.staff.name}`);
  return NextResponse.json({ ok: true });
}
