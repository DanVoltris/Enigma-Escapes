import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { deleteBlockRule, getBlockRule } from "@/lib/blocks";
import { logActivity } from "@/lib/db";
import { getExperience } from "@/lib/experiences";
import { formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// Remove a repeating block: every session it held goes back on sale.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("blocks");
  if (guard.response) return guard.response;
  const { id } = await params;
  try {
    const rule = await getBlockRule(id);
    const room = rule ? await getExperience(rule.roomId) : undefined;
    if (rule && !canSeeLocation(guard.staff, room?.location ?? "")) {
      return NextResponse.json({ error: "That room is at a location your account doesn't cover." }, { status: 403 });
    }
    const gone = await deleteBlockRule(id);
    if (gone) {
      await logActivity(
        "Repeating block removed",
        `${room?.name ?? gone.roomId} ${gone.times.map(formatTime).join(", ")} — back on sale — ${guard.staff.name || guard.staff.email}`
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("removing repeating block failed:", err);
    return NextResponse.json({ error: "Could not remove that repeating block right now. Please try again." }, { status: 500 });
  }
}
