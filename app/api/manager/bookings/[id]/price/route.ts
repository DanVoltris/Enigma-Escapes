import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { getBooking } from "@/lib/db";
import { setSessionPrice } from "@/lib/manage-booking";

export const dynamic = "force-dynamic";

// Set what each person on one session pays — a group rate agreed on the phone.
// The amount is as staff say it, tax included; lib/manage-booking.ts turns it
// into the session's stored price and rebuilds the totals.
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
  const paidPerPersonCents = Number(raw.paidPerPersonCents);
  if (!Number.isFinite(paidPerPersonCents)) {
    return NextResponse.json({ error: "Enter the price per person." }, { status: 400 });
  }

  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
  if (!booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
    return NextResponse.json({ error: "That booking is at a location your account doesn't cover." }, { status: 403 });
  }
  const itemIndex = Number.isInteger(raw.itemIndex) ? (raw.itemIndex as number) : -1;
  if (itemIndex < 0 || itemIndex >= booking.items.length) {
    return NextResponse.json({ error: "That session is no longer on this booking." }, { status: 400 });
  }

  const result = await setSessionPrice(booking, itemIndex, paidPerPersonCents, guard.staff.name || guard.staff.email);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, totalCents: result.pricing.totalCents, balanceCents: result.pricing.balanceCents });
}
