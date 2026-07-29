import { NextRequest, NextResponse } from "next/server";
import { addEditNote, deleteEditNote, setEditNoteDone } from "@/lib/edit-notes";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const author = typeof o.author === "string" ? o.author.trim().slice(0, 40) : "";
  const text = typeof o.text === "string" ? o.text.trim().slice(0, 2000) : "";
  if (!author) return NextResponse.json({ error: "Add your name so your partner knows who wrote it." }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Write the note first." }, { status: 400 });
  try {
    const note = await addEditNote(author, text);
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    console.error("adding edit note failed:", err);
    return NextResponse.json({ error: "Could not save the note right now. Please try again." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.done !== "boolean") {
    return NextResponse.json({ error: "Send the note id and its done state." }, { status: 400 });
  }
  try {
    const ok = await setEditNoteDone(o.id, o.done);
    if (!ok) return NextResponse.json({ error: "That note no longer exists." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updating edit note failed:", err);
    return NextResponse.json({ error: "Could not update the note right now. Please try again." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof o.id !== "string") return NextResponse.json({ error: "Send the note id." }, { status: 400 });
  try {
    const ok = await deleteEditNote(o.id);
    if (!ok) return NextResponse.json({ error: "That note no longer exists." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleting edit note failed:", err);
    return NextResponse.json({ error: "Could not delete the note right now. Please try again." }, { status: 500 });
  }
}
