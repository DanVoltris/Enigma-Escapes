import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { deleteStaffNote } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("notes");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;
  try {
    await deleteStaffNote(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleting note failed:", err);
    return NextResponse.json({ error: "Could not delete the note right now. Please try again." }, { status: 500 });
  }
}
