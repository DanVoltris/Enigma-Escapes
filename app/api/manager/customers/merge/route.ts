import { NextRequest, NextResponse } from "next/server";
import { aggregateCustomers, deleteManualCustomer, listManualCustomers } from "@/lib/customers";
import { listBookings, logActivity, updateBookingCustomer } from "@/lib/db";

export const dynamic = "force-dynamic";

// Merge one customer identity into another: every booking under fromEmail is
// rewritten to the kept customer's email/name/phone (participants preserved),
// and fromEmail's manual entry is removed. Deliberately normalizes history —
// that's what a staff-initiated merge is for. Not reversible.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const fromEmail = typeof o.fromEmail === "string" ? o.fromEmail.trim().toLowerCase() : "";
  const toEmail = typeof o.toEmail === "string" ? o.toEmail.trim().toLowerCase() : "";
  if (!fromEmail || !toEmail) return NextResponse.json({ error: "Pick both customers first." }, { status: 400 });
  if (fromEmail === toEmail) {
    return NextResponse.json({ error: "Those are the same customer — pick two different ones." }, { status: 400 });
  }

  try {
    const [bookings, manual] = await Promise.all([listBookings(), listManualCustomers()]);
    const rows = await aggregateCustomers(bookings, manual);
    const target = rows.find((r) => r.email.toLowerCase() === toEmail);
    const source = rows.find((r) => r.email.toLowerCase() === fromEmail);
    if (!target || !source) {
      return NextResponse.json({ error: "One of those customers no longer exists — refresh and try again." }, { status: 404 });
    }

    const [targetFirst, ...targetRest] = target.name.split(" ");
    const sourceBookings = bookings.filter((b) => b.customer.email.toLowerCase() === fromEmail);
    for (const b of sourceBookings) {
      await updateBookingCustomer(b.id, {
        ...b.customer, // keeps participants and anything else attached
        firstName: targetFirst ?? "",
        lastName: targetRest.join(" "),
        email: target.email,
        phone: target.phone,
        subscribe: target.subscribed,
      });
    }
    await deleteManualCustomer(fromEmail);
    await logActivity("Customers merged", `${source.name} (${fromEmail}) → ${target.name} (${target.email}), ${sourceBookings.length} booking(s) moved`);
    return NextResponse.json({ ok: true, moved: sourceBookings.length });
  } catch (err) {
    console.error("merging customers failed:", err);
    return NextResponse.json({ error: "Could not merge right now. Please try again." }, { status: 500 });
  }
}
