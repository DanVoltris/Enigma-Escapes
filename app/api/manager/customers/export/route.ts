import { NextRequest } from "next/server";
import { aggregateCustomers, listManualCustomers } from "@/lib/customers";
import { listBookings } from "@/lib/db";

export const dynamic = "force-dynamic";

function csvField(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

// CSV download of the customer list — ?subscribed=1 narrows to the marketing
// subscriber list (the file most email/ads tools import directly).
export async function GET(req: NextRequest) {
  const subscribedOnly = req.nextUrl.searchParams.get("subscribed") === "1";
  const [bookings, manual] = await Promise.all([listBookings(), listManualCustomers()]);
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
