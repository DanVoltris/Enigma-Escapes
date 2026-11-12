import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { deletePromo, getPromo, logActivity, updatePromo } from "@/lib/db";
import { PROMO_ROOMS_MIGRATION, parsePromoRooms } from "@/lib/promo-rooms";
import { STAFF_ONLY_MIGRATION } from "../route";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const guard = await apiGuard("promos");
  if (guard.response) return guard.response;
  const { code: rawCode } = await ctx.params;
  const code = decodeURIComponent(rawCode).toUpperCase();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const d = body as { active?: unknown; staffOnly?: unknown; roomIds?: unknown };
  const active = typeof d.active === "boolean" ? d.active : undefined;
  const staffOnly = typeof d.staffOnly === "boolean" ? d.staffOnly : undefined;
  const changingRooms = d.roomIds !== undefined;
  if (active === undefined && staffOnly === undefined && !changingRooms) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    if (!(await getPromo(code))) {
      return NextResponse.json({ error: "That code no longer exists." }, { status: 404 });
    }
    let rooms: { ids: string[]; names: string[] } | undefined;
    if (changingRooms) {
      const parsed = await parsePromoRooms(d.roomIds);
      if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      rooms = parsed;
    }
    // Bookings already made keep the discount they were sold with: they carry
    // their own copy of the rooms (pricing.promoRoomIds).
    await updatePromo(code, { active, staffOnly, roomIds: rooms?.ids });
    if (rooms) {
      await logActivity(
        "Promo code rooms changed",
        `${code} — ${rooms.names.length ? `${rooms.names.join(", ")} only` : "every room"}`
      );
    }
    if (active !== undefined) await logActivity(active ? "Turned on promo code" : "Turned off promo code", code);
    if (staffOnly !== undefined) {
      await logActivity(staffOnly ? "Promo code made staff-only" : "Promo code opened to the website", code);
    }
    return NextResponse.json({ code });
  } catch (err) {
    console.error("updating promo failed:", err);
    if (staffOnly !== undefined && err instanceof Error && err.message.includes("staff_only")) {
      return NextResponse.json({ error: STAFF_ONLY_MIGRATION }, { status: 500 });
    }
    if (changingRooms && err instanceof Error && err.message.includes("room_ids")) {
      return NextResponse.json({ error: PROMO_ROOMS_MIGRATION }, { status: 500 });
    }
    return NextResponse.json(
      { error: "Could not update the code right now. Please try again shortly." },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const guard = await apiGuard("promos");
  if (guard.response) return guard.response;
  const { code: rawCode } = await ctx.params;
  const code = decodeURIComponent(rawCode).toUpperCase();
  try {
    if (!(await getPromo(code))) {
      return NextResponse.json({ error: "That code no longer exists." }, { status: 404 });
    }
    await deletePromo(code);
    await logActivity("Removed promo code", code);
    return NextResponse.json({ code });
  } catch (err) {
    console.error("removing promo failed:", err);
    return NextResponse.json(
      { error: "Could not remove the code right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
