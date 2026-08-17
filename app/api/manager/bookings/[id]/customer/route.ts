import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import {
  addBookingNote,
  getBooking,
  listBookingsForEmail,
  logActivity,
  updateBookingCustomer,
  updateCustomerAcrossBookings,
} from "@/lib/db";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s()+-]{7,}$/;

// How many other live bookings carry this address — the answer to "will fixing
// this one leave the rest wrong?", which it usually would.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;

  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
  if (!booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
    return NextResponse.json({ error: "That booking is at a location your account doesn't cover." }, { status: 403 });
  }
  const others = (await listBookingsForEmail(booking.customer.email)).filter((b) => b.id !== id);
  return NextResponse.json({
    customer: {
      firstName: booking.customer.firstName,
      lastName: booking.customer.lastName,
      email: booking.customer.email,
      phone: booking.customer.phone,
    },
    otherBookings: others.length,
  });
}

// Correct the contact details on a booking — a mistyped address the confirmation
// never reached, a new phone number.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;

  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const firstName = str(raw.firstName, 100);
  const lastName = str(raw.lastName, 100);
  const email = str(raw.email, 200).toLowerCase();
  const phone = str(raw.phone, 30);
  const alsoOthers = raw.alsoOthers === true;

  if (!firstName) return NextResponse.json({ error: "Enter a first name." }, { status: 400 });
  if (!lastName) return NextResponse.json({ error: "Enter a last name." }, { status: 400 });
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  }
  if (!PHONE_RE.test(phone)) {
    return NextResponse.json({ error: "That phone number doesn't look right." }, { status: 400 });
  }

  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });
  if (!booking.items.every((i) => canSeeLocation(guard.staff, i.location))) {
    return NextResponse.json({ error: "That booking is at a location your account doesn't cover." }, { status: 403 });
  }

  const was = booking.customer;
  const unchanged =
    was.firstName === firstName && was.lastName === lastName && was.email === email && was.phone === phone;
  if (unchanged) return NextResponse.json({ ok: true, changed: 0, note: "Nothing was different." });

  // What actually changed, for the note — "contact details updated" tells the
  // next person nothing, and this is a record of somebody's identity.
  const diffs: string[] = [];
  if (was.firstName !== firstName || was.lastName !== lastName) {
    diffs.push(`name ${was.firstName} ${was.lastName} → ${firstName} ${lastName}`);
  }
  if (was.email !== email) diffs.push(`email ${was.email} → ${email}`);
  if (was.phone !== phone) diffs.push(`phone ${was.phone || "none"} → ${phone}`);

  try {
    let changed = 1;
    let failed: string[] = [];
    if (alsoOthers) {
      const result = await updateCustomerAcrossBookings(was.email, { firstName, lastName, email, phone });
      changed = result.changed;
      failed = result.failed;
      // The chosen booking may not be live (cancelled ones are skipped above),
      // so it's corrected on its own to be sure.
      await updateBookingCustomer(id, { ...was, firstName, lastName, email, phone });
    } else {
      await updateBookingCustomer(id, { ...was, firstName, lastName, email, phone });
    }

    const who = guard.staff.name || guard.staff.email;
    await addBookingNote(booking.id, `Contact details corrected — ${diffs.join("; ")}.`, who);
    await logActivity("Contact details corrected", `${booking.reference} — ${who} — ${diffs.join("; ")}`);
    return NextResponse.json({ ok: true, changed, failed });
  } catch (err) {
    console.error("correcting contact details failed:", err);
    return NextResponse.json({ error: "Could not save that. Try again shortly." }, { status: 500 });
  }
}
