import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { customerRosterPage, storedNamesFor } from "@/lib/customers";

export const dynamic = "force-dynamic";

// Typeahead for the Book now form: match known customers by name, email or
// phone.
//
// This used to fetch every customer AND every booking on each keystroke and
// filter them in memory. At 44k customers and 29k bookings that is 74 database
// queries per keypress taking ~29 seconds, and it became the heaviest thing
// running against the database — hours of query time in a single afternoon,
// enough to starve everything else, including the availability check that
// stands between a customer and a booking. The search now happens in Postgres
// and returns at most six rows.
export async function GET(req: NextRequest) {
  const guard = await apiGuard("bookings.create");
  if (guard.response) return guard.response;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ customers: [] });

  try {
    const page = await customerRosterPage({ q, limit: 6, offset: 0 });
    if (!page) return NextResponse.json({ customers: [] }); // SQL function not installed
    // The roster carries one display name; the form wants first and last
    // separately, so prefer the stored spelling where there is one.
    const stored = await storedNamesFor(page.rows.map((r) => r.email));
    const customers = page.rows.map((r) => {
      const known = stored.get(r.email.toLowerCase());
      if (known) return { firstName: known.firstName, lastName: known.lastName, email: r.email, phone: r.phone };
      const name = r.name.trim();
      const cut = name.indexOf(" ");
      return {
        firstName: cut === -1 ? name : name.slice(0, cut),
        lastName: cut === -1 ? "" : name.slice(cut + 1),
        email: r.email,
        phone: r.phone,
      };
    });
    return NextResponse.json({ customers });
  } catch (err) {
    console.error("customer search failed:", err);
    return NextResponse.json({ customers: [] }); // typeahead failure is never fatal
  }
}
