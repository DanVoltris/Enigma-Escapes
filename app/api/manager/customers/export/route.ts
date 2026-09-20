import { NextRequest } from "next/server";
import { allowedLocations, apiGuard } from "@/lib/auth";
import { aggregateCustomers, listManualCustomers } from "@/lib/customers";
import { listBookings } from "@/lib/db";

export const dynamic = "force-dynamic";

// Names are typed by anyone on the public checkout, and Excel or Sheets runs a
// cell starting with = + - @ (or a tab/CR) as a formula — a HYPERLINK that
// ships the neighbouring emails off-site. A leading ' makes it plain text. A
// plain phone number like "+1 204 555 0100" is left alone: it can't call a
// function, and email tools importing the file want it as typed.
function csvField(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) && !/^\+?[\d\s().-]+$/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

// CSV download of the customer list — ?subscribed=1 narrows to the marketing
// subscriber list (the file most email/ads tools import directly).
export async function GET(req: NextRequest) {
  const guard = await apiGuard("customers.export");
  if (guard.response) return guard.response;
  const subscribedOnly = req.nextUrl.searchParams.get("subscribed") === "1";
  const [allBookings, manual] = await Promise.all([listBookings(), listManualCustomers()]);
  // The same location cut the Customers tab makes, so a limited account's file
  // holds the people it can see on screen and nobody else's.
  const scope = allowedLocations(guard.staff);
  const bookings = scope ? allBookings.filter((b) => b.items.some((i) => scope.includes(i.location))) : allBookings;
  let rows = await aggregateCustomers(bookings, manual);
  if (subscribedOnly) rows = rows.filter((r) => r.subscribed);

  const lines = [
    "name,email,phone,subscribed,bookings,guests,paid_cents",
    ...rows.map((r) =>
      [csvField(r.name), csvField(r.email), csvField(r.phone), r.subscribed ? "yes" : "no", r.bookings, r.guests, r.spentCents].join(",")
    ),
  ];
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${subscribedOnly ? "subscribers" : "customers"}.csv"`,
    },
  });
}
