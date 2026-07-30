import { NextRequest, NextResponse } from "next/server";
import { remainingSpots } from "@/lib/capacity";
import { bookedCount, logActivity } from "@/lib/db";
import { getExperience } from "@/lib/experiences";
import { formatTime } from "@/lib/format";
import { getRequestById, setRequestStatus } from "@/lib/requests";
import { notifyRequestDecision } from "@/lib/sms";

export const dynamic = "force-dynamic";

// Manager decides a request: accept (capacity re-checked, customer texted the
// completion link) or decline (customer texted). Returns the completion URL so
// staff can copy/send it manually while SMS isn't configured.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = o.action === "accept" || o.action === "decline" ? o.action : null;
  if (!action) return NextResponse.json({ error: "Send an action: accept or decline." }, { status: 400 });

  const request = await getRequestById(id);
  if (!request) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
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
      const remaining = remainingSpots(exp, await bookedCount(request.roomId, request.date, request.time));
      if (remaining < request.quantity) {
        return NextResponse.json(
          { error: `Only ${remaining} spot(s) left at ${formatTime(request.time)} — can't fit ${request.quantity}.` },
          { status: 400 }
        );
      }
    }
    await setRequestStatus(id, action === "accept" ? "accepted" : "declined");
    await notifyRequestDecision(request, action === "accept", req.nextUrl.origin);
    await logActivity(
      `Booking request ${action === "accept" ? "accepted" : "declined"}`,
      `${request.roomName} ${formatTime(request.time)} — ${request.firstName} ${request.lastName}`
    );
    return NextResponse.json({
      ok: true,
      completionUrl: action === "accept" ? `${req.nextUrl.origin}/request/${request.token}` : null,
    });
  } catch (err) {
    console.error("deciding request failed:", err);
    return NextResponse.json({ error: "Could not update the request right now. Please try again." }, { status: 500 });
  }
}
