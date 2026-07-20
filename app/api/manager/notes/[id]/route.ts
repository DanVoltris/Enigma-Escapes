import { NextResponse } from "next/server";
import { deleteStaffNote } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await deleteStaffNote(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleting note failed:", err);
    return NextResponse.json({ error: "Could not delete the note right now. Please try again." }, { status: 500 });
  }
}
