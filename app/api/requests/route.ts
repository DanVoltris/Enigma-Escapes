import { NextRequest, NextResponse } from "next/server";
import { isBlocked } from "@/lib/blocks";
import { remainingSpots } from "@/lib/capacity";
import { bookedCount, logActivity } from "@/lib/db";
import { getExperience } from "@/lib/experiences";
import { formatTime, isValidISODate, minutesUntilSlot, REQUEST_WINDOW_MINUTES } from "@/lib/format";
import { getLocationHours } from "@/lib/hours";
import { createRequest } from "@/lib/requests";
import { notifyNewRequest } from "@/lib/sms";
import { startTimesFor } from "@/lib/schedule";

export const dynamic = "force-dynamic";

const PHONE_RE = /^[\d\s()+-]{7,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public: a customer asks for a slot that starts within the request window.
// No payment, no hold — the manager accepts or declines from the Requests tab.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  const firstName = typeof o.firstName === "string" ? o.firstName.trim().slice(0, 100) : "";
  const lastName = typeof o.lastName === "string" ? o.lastName.trim().slice(0, 100) : "";
  const phone = typeof o.phone === "string" ? o.phone.trim().slice(0, 30) : "";
  const email = typeof o.email === "string" && o.email.trim() ? o.email.trim().slice(0, 200) : null;
  if (!firstName) return NextResponse.json({ error: "Enter your first name." }, { status: 400 });
  if (!PHONE_RE.test(phone)) {
    return NextResponse.json({ error: "Enter a valid phone number — we confirm requests by text." }, { status: 400 });
  }
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  }

  const roomId = typeof o.roomId === "string" ? o.roomId : "";
  const date = typeof o.date === "string" ? o.date : "";
  const time = typeof o.time === "string" ? o.time : "";
  const exp = roomId ? await getExperience(roomId) : undefined;
  if (!exp || !exp.active || !isValidISODate(date)) {
    return NextResponse.json({ error: "That session no longer exists — refresh and try again." }, { status: 400 });
  }
  const hours = exp.scheduleMode === "store" ? await getLocationHours(exp.location) : null;
  if (!startTimesFor(exp, date, hours).includes(time)) {
    return NextResponse.json({ error: "That time slot is not available on that day." }, { status: 400 });
  }
  if (await isBlocked(exp.id, date, time)) {
    return NextResponse.json({ error: "That session isn't running — please pick another time." }, { status: 400 });
  }
  const untilStart = minutesUntilSlot(date, time);
  if (untilStart <= 0) {
    return NextResponse.json({ error: `${formatTime(time)} has already started — pick a later time.` }, { status: 400 });
  }
  if (untilStart > REQUEST_WINDOW_MINUTES) {
    return NextResponse.json(
      { error: "That session is far enough away to book normally — no request needed." },
      { status: 400 }
    );
  }
  const quantity = typeof o.quantity === "number" && Number.isInteger(o.quantity) ? o.quantity : 0;
  if (quantity < 1 || quantity > exp.capacity) {
    return NextResponse.json({ error: `Guests must be between 1 and ${exp.capacity}.` }, { status: 400 });
  }
  const remaining = remainingSpots(exp, await bookedCount(exp.id, date, time));
  if (remaining < quantity) {
    return NextResponse.json(
      { error: `Only ${remaining} spot(s) remain at ${formatTime(time)} — lower the group size or pick another time.` },
      { status: 400 }
    );
  }

  try {
    const request = await createRequest({
      roomId: exp.id, roomName: exp.name, location: exp.location,
      date, time, quantity, firstName, lastName, phone, email,
    });
    await logActivity("Booking request received", `${exp.name} ${formatTime(time)} — ${firstName} ${lastName}, ${quantity} guests`);
    // Best-effort: the request is already saved, so a failed text must never
    // turn into an error the customer sees.
    await notifyNewRequest(
      { roomName: exp.name, location: exp.location, date, time, quantity, firstName, lastName, phone },
      req.nextUrl.origin
    );
    return NextResponse.json({ ok: true, id: request.id }, { status: 201 });
  } catch (err) {
    console.error("creating booking request failed:", err);
    return NextResponse.json({ error: "Could not send your request right now. Please call us instead." }, { status: 500 });
  }
}
