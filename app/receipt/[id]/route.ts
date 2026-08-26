import { NextRequest } from "next/server";
import { getBooking } from "@/lib/db";
import { renderDocument, type DocumentLine } from "@/lib/documents";
import { getBusinessDetails } from "@/lib/settings";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

// The customer's receipt. The booking's UUID is the secret, the same way
// /booking/<id> already works.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const booking = await getBooking(id).catch(() => null);
  if (!booking) return new Response(notFoundPage(), { status: 404, headers: html() });

  const [business, site] = await Promise.all([getBusinessDetails(), getSiteSettings()]);
  const b = business.value;
  if (!b?.companyName) return new Response(notFoundPage(), { status: 404, headers: html() });

  const p = booking.pricing;
  const lines: DocumentLine[] = booking.items.map((i) => ({
    roomName: i.roomName,
    location: i.location,
    date: i.date,
    time: i.time,
    quantity: i.quantity,
    unitCents: i.priceCents,
    lineCents: i.priceCents * i.quantity,
  }));
  if (p.flatFeeCents && p.flatFeeCents > 0) {
    lines.push({
      roomName: "Event fee",
      location: null,
      date: null,
      time: null,
      quantity: 1,
      unitCents: p.flatFeeCents,
      lineCents: p.flatFeeCents,
    });
  }

  return new Response(
    renderDocument({
      kind: "receipt",
      number: booking.reference,
      issuedOn: booking.createdAt.slice(0, 10),
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`.trim(),
      customerEmail: booking.customer.email || "",
      lines,
      totals: {
        subtotalCents: p.subtotalCents,
        discountCents: p.discountCents,
        taxCents: p.gstCents,
        taxLabel: b.taxLabel || "GST",
        totalCents: p.totalCents,
        paidCents: p.paidCents,
        balanceCents: p.balanceCents,
      },
      note: null,
      viewUrl: null,
      business: b,
      logoUrl: site.logoUrl || null,
      accent: site.brandColor || null,
    }),
    { headers: html() }
  );
}

function html() {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
  };
}

function notFoundPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt not found</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:48px;color:#16212b;">
<h1 style="font-size:20px;">This receipt isn't available</h1>
<p style="color:#5b6670;">The link may be out of date. Please contact us and we'll send a fresh copy.</p>
</body></html>`;
}
