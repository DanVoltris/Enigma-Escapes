import { NextRequest, NextResponse } from "next/server";
import { listBookings } from "@/lib/db";

export const dynamic = "force-dynamic";

// Typeahead for the walk-in form: match known customers (derived from
// bookings, newest first, deduped by email) by name, email or phone.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ customers: [] });

  try {
    const bookings = await listBookings(); // newest first
    const seen = new Set<string>();
    const matches: { firstName: string; lastName: string; email: string; phone: string }[] = [];
    for (const b of bookings) {
      const c = b.customer;
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
