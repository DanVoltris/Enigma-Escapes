import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { deleteBlock, getBlock } from "@/lib/blocks";
import { logActivity } from "@/lib/db";
import { formatDateLong, formatTime } from "@/lib/format";
import { getExperience } from "@/lib/experiences";

export const dynamic = "force-dynamic";

// Unblock a single slot.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("blocks");
  if (guard.response) return guard.response;
  const { id } = await params;
  try {
    // Checked before the delete: a limited account may only put its own
    // locations' sessions back on sale.
    const block = await getBlock(id);
    if (block) {
      const blockRoom = await getExperience(block.roomId);
      if (!canSeeLocation(guard.staff, blockRoom?.location ?? "")) {
        return NextResponse.json({ error: "That slot is at a location your account doesn't cover." }, { status: 403 });
      }
    }
    const gone = await deleteBlock(id);
    // "Slot unblocked — <uuid>" told nobody anything the next time someone asked
    // why a session was on or off sale.
    const room = gone ? await getExperience(gone.roomId).catch(() => undefined) : undefined;
    await logActivity(
      "Slot unblocked",
      gone
        ? `${room?.name ?? gone.roomId} ${formatTime(gone.time)} on ${formatDateLong(gone.date)} — back on sale — ${guard.staff.name || guard.staff.email}`
        : id
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("unblocking slot failed:", err);
    return NextResponse.json({ error: "Could not unblock that slot right now. Please try again." }, { status: 500 });
  }
}
