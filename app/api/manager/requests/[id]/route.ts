import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { minutesToTime, overlappedBy, remainingSpots } from "@/lib/capacity";
import { bookedCount, busySessionsForDate, logActivity } from "@/lib/db";
import { getExperience } from "@/lib/experiences";
import { formatTime } from "@/lib/format";
import { buildBooking } from "@/lib/create-booking";
import { saveBooking } from "@/lib/db";
import { getRequestById, setRequestStatus } from "@/lib/requests";
import { notifyRequestDecision } from "@/lib/sms";

export const dynamic = "force-dynamic";

// Manager decides a request: accept or decline.
//
// Accepting BOOKS it — unpaid, payable in store — rather than sending the
// customer off to pay online. The slot was already held by the request; the
// booking is what keeps holding it, and it is what gets cancelled if they
// don't reply Y within the window.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("requests");
  if (guard.response) return guard.response;
  const { id } = await params;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = o.action === "accept" || o.action === "decline" ? o.action : null;
  if (!action) return NextResponse.json({ error: "Send an action: accept or decline." }, { status: 400 });

  const request = await getRequestById(id);
  if (!request) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
  if (!canSeeLocation(guard.staff, request.location)) {
    return NextResponse.json({ error: "That request is for another location." }, { status: 403 });
  }
  if (request.status === "expired") {
    return NextResponse.json({ error: "That request's session time has passed." }, { status: 400 });
  }
  if (request.status !== "pending") {
    return NextResponse.json({ error: `Already ${request.status}.` }, { status: 400 });
  }

  try {
    if (action === "accept") {
      const exp = await getExperience(request.roomId);
      if (!exp || !exp.active) return NextResponse.json({ error: "That room no longer exists." }, { status: 400 });
      // Checked again at acceptance: the room may have been filled, or a
      // neighbouring game booked, while the request sat waiting.
      const clash = overlappedBy(
        (await busySessionsForDate(request.date)).get(request.roomId),
        request.time,
        exp.durationMinutes
      );
      if (clash) {
        return NextResponse.json(
          {
            error:
              `${exp.name} is running ${formatTime(clash.time)}–${formatTime(minutesToTime(clash.end))} that day, ` +
              `so this session can't run. Decline it, or move the other booking first.`,
          },
          { status: 409 }
        );
      }
      const remaining = remainingSpots(exp, await bookedCount(request.roomId, request.date, request.time));
      if (remaining < request.quantity) {
        return NextResponse.json(
          { error: `Only ${remaining} spot(s) left at ${formatTime(request.time)} — can't fit ${request.quantity}.` },
          { status: 400 }
        );
      }
    }
    let bookingId: string | undefined;
    if (action === "accept") {
      // Built through the same path as any other booking, so pricing, capacity
      // and blocked slots are all re-checked. Nothing is collected: the whole
      // total sits as a balance for the desk.
      const built = await buildBooking(
        {
          paymentOption: "none",
          customer: {
            firstName: request.firstName,
            lastName: request.lastName,
            email: request.email || `${request.phone.replace(/\D/g, "")}@no-email.invalid`,
            phone: request.phone,
            subscribe: false,
          },
          items: [
            { roomId: request.roomId, date: request.date, time: request.time, quantity: request.quantity },
          ],
        },
        "in_person" // staff acting at the desk: exempt from the online-only rules
      );
      if ("error" in built) return NextResponse.json({ error: built.error }, { status: 400 });
      await saveBooking(built.booking);
      bookingId = built.booking.id;
    }

    await setRequestStatus(id, action === "accept" ? "accepted" : "declined", bookingId);
    await notifyRequestDecision(request, action === "accept", req.nextUrl.origin);
    await logActivity(
      `Booking request ${action === "accept" ? "accepted" : "declined"}`,
      `${request.roomName} ${formatTime(request.time)} — ${request.firstName} ${request.lastName}` +
        (action === "accept" ? " — held, awaiting their Y" : "")
    );
    return NextResponse.json({ ok: true, bookingId: bookingId ?? null });
  } catch (err) {
    console.error("deciding request failed:", err);
    return NextResponse.json({ error: "Could not update the request right now. Please try again." }, { status: 500 });
  }
}
