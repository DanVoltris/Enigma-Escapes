import { NextRequest, NextResponse } from "next/server";
import { allowedLocations, apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { documentSubject, renderDocument, type DocumentLine } from "@/lib/documents";
import { emailConfigured, isEmail, sendEmail } from "@/lib/email";
import { getQuote, lineTotal, markQuoteSent, quoteTotals, visibleToScope } from "@/lib/quotes";
import { getBusinessDetails } from "@/lib/settings";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

// Emails an invoice. Only ever runs because a staff member pressed the button —
// nothing in the booking flow calls this.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.create");
  if (guard.response) return guard.response;

  const { id } = await ctx.params;
  const quote = await getQuote(id);
  if (!quote) return NextResponse.json({ error: "That invoice no longer exists." }, { status: 404 });
  if (quote.status === "void") {
    return NextResponse.json({ error: "That invoice was voided. Raise a new one." }, { status: 400 });
  }
  // Hiding it from the list is not the boundary — the send is re-checked here.
  if (!visibleToScope(quote, allowedLocations(guard.staff))) {
    return NextResponse.json({ error: "That invoice is for a location you don't work at." }, { status: 403 });
  }

  if (!emailConfigured()) {
    return NextResponse.json(
      { error: "Email isn't set up yet. Add RESEND_API_KEY and EMAIL_FROM, then redeploy." },
      { status: 400 }
    );
  }

  // The form's address unless staff typed a different one on the send dialog.
  let to = quote.customer.email;
  try {
    const body = (await req.json()) as { to?: unknown };
    if (typeof body?.to === "string" && body.to.trim()) to = body.to.trim();
  } catch {
    /* no body is fine — send to the address on the invoice */
  }
  if (!isEmail(to)) {
    return NextResponse.json({ error: `"${to}" doesn't look like an email address.` }, { status: 400 });
  }

  const [business, site] = await Promise.all([getBusinessDetails(), getSiteSettings()]);
  const b = business.value;
  if (!b?.companyName) {
    return NextResponse.json(
      { error: "Fill in your business details first — an invoice needs your company name on it." },
      { status: 400 }
    );
  }

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
    customerEmail: to,
    lines,
    totals: {
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      taxCents: totals.taxCents,
      taxLabel: b.taxLabel || "GST",
      totalCents: totals.totalCents,
      balanceCents: totals.totalCents, // an invoice is entirely outstanding
    },
    note: quote.note || null,
    viewUrl: `${req.nextUrl.origin}/invoice/${quote.token}`,
    business: b,
    logoUrl: site.logoUrl || null,
    accent: site.brandColor || null,
  };

  const sent = await sendEmail({
    to,
    subject: documentSubject(doc),
    html: renderDocument(doc),
    replyTo: b.email || null,
  });
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });

  try {
    await markQuoteSent(quote.id, to);
    await logActivity("Emailed invoice", `${quote.number} to ${to}`);
  } catch (err) {
    // The customer has it; losing the bookkeeping is not worth an error screen.
    console.error("marking quote sent failed:", err);
  }
  return NextResponse.json({ ok: true, to });
}
