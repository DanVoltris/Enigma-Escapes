import { NextRequest, NextResponse } from "next/server";
import { deleteBlock } from "@/lib/blocks";
import { logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

// Unblock a single slot.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteBlock(id);
    await logActivity("Slot unblocked", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("unblocking slot failed:", err);
    return NextResponse.json({ error: "Could not unblock that slot right now. Please try again." }, { status: 500 });
  }
}
