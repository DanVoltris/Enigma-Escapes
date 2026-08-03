import { randomUUID } from "crypto";
import { apiGuard } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { getBooking, logActivity, updateBookingFields } from "@/lib/db";
import type { Participant } from "@/lib/types";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Attach a participant (extra guest) to a booking.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const d = body as { firstName?: unknown; lastName?: unknown; email?: unknown };
  const firstName = typeof d.firstName === "string" ? d.firstName.trim().slice(0, 60) : "";
  const lastName = typeof d.lastName === "string" ? d.lastName.trim().slice(0, 60) : "";
  const email = typeof d.email === "string" ? d.email.trim().toLowerCase().slice(0, 120) : "";

  if (!firstName || !lastName) {
    return NextResponse.json({ error: "Enter the participant's first and last name." }, { status: 400 });
  }
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "That email address doesn't look right. Fix it or leave it blank." }, { status: 400 });
  }

  try {
    const booking = await getBooking(id);
    if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });

    const participant: Participant = {
      id: randomUUID(),
      firstName,
      lastName,
      email: email || null,
      addedAt: new Date().toISOString(),
    };
    const customer = {
      ...booking.customer,
      participants: [...(booking.customer.participants ?? []), participant],
    };
    await updateBookingFields(id, { customer });
    await logActivity("Added participant", `${firstName} ${lastName} to ${booking.reference}`);
    return NextResponse.json({ ok: true, participant });
  } catch (err) {
    console.error("adding participant failed:", err);
    return NextResponse.json({ error: "Could not add the participant right now. Please try again." }, { status: 500 });
  }
}

// Remove a participant from a booking.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;
  const pid = req.nextUrl.searchParams.get("pid") ?? "";
  if (!pid) return NextResponse.json({ error: "Missing participant id." }, { status: 400 });

  try {
    const booking = await getBooking(id);
    if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
    const participants = booking.customer.participants ?? [];
    const participant = participants.find((p) => p.id === pid);
    if (!participant) return NextResponse.json({ error: "That participant no longer exists." }, { status: 404 });

    const customer = {
      ...booking.customer,
      participants: participants.filter((p) => p.id !== pid),
    };
    await updateBookingFields(id, { customer });
    await logActivity("Removed participant", `${participant.firstName} ${participant.lastName} from ${booking.reference}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("removing participant failed:", err);
    return NextResponse.json({ error: "Could not remove the participant right now. Please try again." }, { status: 500 });
  }
}
