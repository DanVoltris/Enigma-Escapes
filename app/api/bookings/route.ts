import { NextRequest, NextResponse } from "next/server";
import { buildBooking } from "@/lib/create-booking";
import { saveBooking } from "@/lib/db";
import { getRequestByToken, setRequestStatus } from "@/lib/requests";
import { notifyBookingConfirmed } from "@/lib/sms";

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
  await notifyBookingConfirmed(result.booking, req.nextUrl.origin); // best-effort; never throws

  // An accepted request that just completed checkout gets closed out.
  const token = (body as { requestToken?: unknown }).requestToken;
  if (typeof token === "string" && token) {
    try {
      const request = await getRequestByToken(token);
      if (request && request.status === "accepted") await setRequestStatus(request.id, "completed", result.booking.id);
    } catch (err) {
      console.error("closing request after booking failed:", err); // booking still stands
    }
  }
  return NextResponse.json({ id: result.booking.id, reference: result.booking.reference }, { status: 201 });
}
