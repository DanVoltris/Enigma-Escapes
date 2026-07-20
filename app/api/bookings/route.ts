import { NextRequest, NextResponse } from "next/server";
import { buildBooking } from "@/lib/create-booking";
import { saveBooking } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const result = await buildBooking(body as Record<string, unknown>, "online");
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

  try {
    await saveBooking(result.booking);
  } catch (err) {
    console.error("saving booking failed:", err);
    return NextResponse.json(
      { error: "Could not save your booking right now. You have not been charged — please try again shortly." },
      { status: 500 }
    );
  }
  return NextResponse.json({ id: result.booking.id, reference: result.booking.reference }, { status: 201 });
}
