import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { getBooking, logActivity, setBookingNoShow } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const d = body as { noShow?: unknown };
  if (typeof d.noShow !== "boolean") {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const booking = await getBooking(id);
    if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
    await setBookingNoShow(id, d.noShow);
    await logActivity(
      d.noShow ? "Marked no-show" : "Cleared no-show",
      `${booking.reference} — ${booking.customer.firstName} ${booking.customer.lastName}`
    );
    return NextResponse.json({ id, noShow: d.noShow });
  } catch (err) {
    console.error("updating no-show failed:", err);
    return NextResponse.json({ error: "Could not update the booking right now. Please try again." }, { status: 500 });
  }
}
