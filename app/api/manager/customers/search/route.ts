import { NextRequest, NextResponse } from "next/server";
import { listManualCustomers } from "@/lib/customers";
import { listBookings } from "@/lib/db";

export const dynamic = "force-dynamic";

// Typeahead for the walk-in form: match known customers (derived from
// bookings, newest first, deduped by email) by name, email or phone.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ customers: [] });

  try {
    const [bookings, manual] = await Promise.all([listBookings(), listManualCustomers()]);
    const seen = new Set<string>();
    const matches: { firstName: string; lastName: string; email: string; phone: string }[] = [];
    // Booking-derived customers first (newest booking wins), then manually
    // added ones that haven't booked yet.
    const candidates = [
      ...bookings.map((b) => b.customer),
      ...manual.map((m) => ({ firstName: m.firstName, lastName: m.lastName, email: m.email, phone: m.phone })),
    ];
    for (const c of candidates) {
      const key = c.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const hay = `${c.firstName} ${c.lastName} ${c.email} ${c.phone}`.toLowerCase();
      if (!hay.includes(q)) continue;
      matches.push({ firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone });
      if (matches.length >= 6) break;
    }
    return NextResponse.json({ customers: matches });
  } catch (err) {
    console.error("customer search failed:", err);
    return NextResponse.json({ customers: [] }); // typeahead failure is never fatal
  }
}
