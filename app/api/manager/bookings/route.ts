import { NextRequest, NextResponse } from "next/server";
import { buildBooking } from "@/lib/create-booking";
import { logActivity, saveBooking } from "@/lib/db";

export const dynamic = "force-dynamic";

// Staff walk-in bookings: same validation/pricing as the public checkout, but
// tagged source "in_person" so the dashboard can split online vs in-person.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const result = await buildBooking(body as Record<string, unknown>, "in_person");
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  try {
    await saveBooking(result.booking);
  } catch (err) {
    console.error("saving walk-in booking failed:", err);
    return NextResponse.json({ error: "Could not save the booking right now. Please try again." }, { status: 500 });
  }
  const b = result.booking;
  const guests = b.items.reduce((s, i) => s + i.quantity, 0);
  await logActivity(
    "Walk-in booking",
    `${b.reference} — ${b.customer.firstName} ${b.customer.lastName}, ${guests} guest(s) for ${b.items[0]?.roomName}`
  );
  return NextResponse.json({ id: b.id, reference: b.reference }, { status: 201 });
}
