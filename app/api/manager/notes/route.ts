import { NextRequest, NextResponse } from "next/server";
import { addStaffNote } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const note = typeof (body as { note?: unknown }).note === "string" ? (body as { note: string }).note.trim() : "";
  if (!note) return NextResponse.json({ error: "Write something first." }, { status: 400 });
  if (note.length > 500) return NextResponse.json({ error: "Keep notes under 500 characters." }, { status: 400 });

  try {
    await addStaffNote(note);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("adding note failed:", err);
    return NextResponse.json({ error: "Could not save the note right now. Please try again." }, { status: 500 });
  }
}
