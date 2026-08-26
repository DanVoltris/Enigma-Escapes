import { NextRequest } from "next/server";
import { documentSubject, renderDocument, type DocumentLine } from "@/lib/documents";
import { getQuoteByToken, lineTotal, quoteTotals } from "@/lib/quotes";
import { getBusinessDetails } from "@/lib/settings";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

// The customer's own copy, reached by the token in their emailed link. Served
// as a route handler rather than a page so it is byte-for-byte the document
// that was emailed — print it and you get what they got.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const quote = await getQuoteByToken(token);
  if (!quote || quote.status === "void") {
    return new Response(notFoundPage(), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const [business, site] = await Promise.all([getBusinessDetails(), getSiteSettings()]);
  const b = business.value;
  if (!b?.companyName) return new Response(notFoundPage(), { status: 404, headers: html() });

  const totals = quoteTotals(quote);
  const lines: DocumentLine[] = quote.lines.map((l) => ({
    roomName: l.roomName,
    location: l.location,
    date: l.date,
    time: l.time,
    quantity: l.quantity,
    unitCents: l.unitCents,
    lineCents: lineTotal(l),
  }));

  const doc = {
    kind: "invoice" as const,
    number: quote.number,
    issuedOn: quote.createdAt.slice(0, 10),
    customerName: quote.customer.company || quote.customer.name,
    customerEmail: quote.customer.email,
    lines,
    totals: {
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      taxCents: totals.taxCents,
      taxLabel: b.taxLabel || "GST",
      totalCents: totals.totalCents,
      balanceCents: totals.totalCents,
    },
    note: quote.note || null,
    viewUrl: null, // already looking at it
    business: b,
    logoUrl: site.logoUrl || null,
    accent: site.brandColor || null,
  };
  void documentSubject; // subject belongs to the email, not the page
  return new Response(renderDocument(doc), { headers: html() });
}

function html() {
  return {
    "content-type": "text/html; charset=utf-8",
    // A document tied to money: never let a proxy keep a stale copy.
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
  };
}

function notFoundPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice not found</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;padding:48px;color:#16212b;">
<h1 style="font-size:20px;">This invoice isn't available</h1>
<p style="color:#5b6670;">The link may be out of date, or the invoice may have been cancelled. Please contact us and we'll send a fresh copy.</p>
</body></html>`;
}
