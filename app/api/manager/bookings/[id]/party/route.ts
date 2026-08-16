import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { getBooking } from "@/lib/db";
import { changePartySize } from "@/lib/manage-booking";

export const dynamic = "force-dynamic";

// How many people are actually playing. The group that booked for four and
// turns up with six is the case this exists for, so the capacity check counts
// only the seats being added — the ones they already hold are theirs.
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
  const quantity = typeof raw.quantity === "number" ? raw.quantity : Number(raw.quantity);
  if (!Number.isFinite(quantity)) {
    return NextResponse.json({ error: "How many guests?" }, { status: 400 });
  }

  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
  if (!booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
    return NextResponse.json({ error: "That booking is at a location your account doesn't cover." }, { status: 403 });
  }

  const itemIndex = Number.isInteger(raw.itemIndex) ? (raw.itemIndex as number) : 0;
  if (itemIndex < 0 || itemIndex >= booking.items.length) {
    return NextResponse.json({ error: "That session is no longer on this booking." }, { status: 400 });
  }

  const result = await changePartySize(booking, quantity, guard.staff.name, itemIndex);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({
    ok: true,
    quantity,
    totalCents: result.pricing.totalCents,
    balanceCents: result.pricing.balanceCents,
  });
}
