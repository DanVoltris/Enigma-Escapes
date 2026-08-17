import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { listBookingsForEmail, logActivity, updateBookingCustomer } from "@/lib/db";
import { deleteManualCustomer, getManualCustomer, upsertManualCustomer } from "@/lib/customers";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s()+-]{7,}$/;

// Editing the person, not one of their bookings.
//
// A customer here is their email address: it keys the stored row and it's how
// every booking is tied back to them. So a change has to land in both places at
// once, or the profile and its history come apart — which is the same split the
// merge tool exists to repair.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ email: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { email: raw } = await ctx.params;
  const oldEmail = decodeURIComponent(raw).trim().toLowerCase();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const firstName = str(body.firstName, 100);
  const lastName = str(body.lastName, 100);
  const email = str(body.email, 200).toLowerCase();
  const phone = str(body.phone, 30);
  const subscribe = body.subscribe === true;

  if (!firstName) return NextResponse.json({ error: "Enter a first name." }, { status: 400 });
  if (!lastName) return NextResponse.json({ error: "Enter a last name." }, { status: 400 });
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  }
  if (phone && !PHONE_RE.test(phone)) {
    return NextResponse.json({ error: "That phone number doesn't look right." }, { status: 400 });
  }

  const movingTo = email !== oldEmail;
  const stored = await getManualCustomer(oldEmail);

  // Moving onto an address somebody else already uses would silently merge two
  // people. That's the merge tool's job, where it's deliberate and reversible.
  if (movingTo) {
    const clash = await getManualCustomer(email);
    const clashBookings = await listBookingsForEmail(email);
    if (clash || clashBookings.length > 0) {
      return NextResponse.json(
        {
          error:
            `${email} already belongs to a customer. To put these two together, use Merge customers — ` +
            `it keeps both histories instead of overwriting one.`,
        },
        { status: 409 }
      );
    }
  }

  try {
    const bookings = await listBookingsForEmail(oldEmail);
    let moved = 0;
    const failed: string[] = [];
    for (const b of bookings) {
      try {
        // Spread first: participants and anything else on the booking's copy
        // stay put.
        await updateBookingCustomer(b.id, { ...b.customer, firstName, lastName, email, phone, subscribe });
        moved++;
      } catch (err) {
        console.error(`updating ${b.reference} failed:`, err);
        failed.push(b.reference);
      }
    }

    // The stored row only exists for people added by hand or brought in by the
    // import; a walk-in customer lives entirely on their bookings.
    if (stored) {
      await upsertManualCustomer({ ...stored, email, firstName, lastName, phone, subscribe });
      if (movingTo) await deleteManualCustomer(oldEmail);
    }

    const who = guard.staff.name || guard.staff.email;
    const what = movingTo ? `${oldEmail} → ${email}` : email;
    await logActivity(
      "Customer details edited",
      `${what} — ${firstName} ${lastName} — ${who} — ${moved} booking(s) updated`
    );
    return NextResponse.json({ ok: true, email, moved, failed });
  } catch (err) {
    console.error("editing the customer failed:", err);
    return NextResponse.json({ error: "Could not save that. Try again shortly." }, { status: 500 });
  }
}
