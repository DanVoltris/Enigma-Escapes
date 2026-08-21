import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { buildBooking } from "@/lib/create-booking";
import { logActivity, saveBooking } from "@/lib/db";
import { notifyBookingConfirmed } from "@/lib/sms";

export const dynamic = "force-dynamic";

// Staff walk-in bookings: same validation/pricing as the public checkout, but
// tagged source "in_person" so the dashboard can split online vs in-person.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("bookings.create");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const result = await buildBooking(body as Record<string, unknown>, "in_person");
  if (!("error" in result) && !result.booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
    return NextResponse.json({ error: "That session is at a location your account doesn\u2019t cover." }, { status: 403 });
  }
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  // Credit the account that took it, so Reports can say who books what. Online
  // bookings have nobody to credit and leave it unset.
  result.booking.bookedBy = guard.staff.name || guard.staff.email;

  try {
    await saveBooking(result.booking);
  } catch (err) {
    console.error("saving walk-in booking failed:", err);
    return NextResponse.json({ error: "Could not save the booking right now. Please try again." }, { status: 500 });
  }
  const b = result.booking;
  // Same confirmation the online customer gets — reference, session details and
  // the link to change or cancel. Best-effort: it never throws, so a texting
  // problem can't lose a booking the desk has already taken. No staff copy;
  // whoever took it is standing right there.
  await notifyBookingConfirmed(b, req.nextUrl.origin, { notifyStaff: false });
  const guests = b.items.reduce((s, i) => s + i.quantity, 0);
  await logActivity(
    "Walk-in booking",
    `${b.reference} — ${b.customer.firstName} ${b.customer.lastName}, ${guests} guest(s) for ${b.items[0]?.roomName}`
  );
  return NextResponse.json({ id: b.id, reference: b.reference }, { status: 201 });
}
