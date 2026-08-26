import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { getBooking, logActivity } from "@/lib/db";
import { documentSubject, renderDocument, type DocumentLine } from "@/lib/documents";
import { emailConfigured, isEmail, sendEmail } from "@/lib/email";
import { getBusinessDetails } from "@/lib/settings";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

// Emails a receipt for a booking that already exists. Click-only: nothing in
// the checkout or the Stripe webhook calls this, so a customer never gets one
// unless a staff member decided to send it.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("bookings.view");
  if (guard.response) return guard.response;

  if (!emailConfigured()) {
    return NextResponse.json(
      { error: "Email isn't set up yet. Add RESEND_API_KEY and EMAIL_FROM, then redeploy." },
      { status: 400 }
    );
  }

  const { id } = await ctx.params;
  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "That booking no longer exists." }, { status: 404 });

  let to = booking.customer.email || "";
  try {
    const body = (await req.json()) as { to?: unknown };
    if (typeof body?.to === "string" && body.to.trim()) to = body.to.trim();
  } catch {
    /* no body is fine — send to the address on the booking */
  }
  if (!isEmail(to)) {
    return NextResponse.json(
      {
        error: booking.customer.email
          ? `"${to}" doesn't look like an email address.`
          : "This booking has no email address on it. Add one, or type where to send it.",
      },
      { status: 400 }
    );
  }

  const [business, site] = await Promise.all([getBusinessDetails(), getSiteSettings()]);
  const b = business.value;
  if (!b?.companyName) {
    return NextResponse.json(
      { error: "Fill in your business details first — a receipt needs your company name on it." },
      { status: 400 }
    );
  }

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
  // A corporate flat fee is charged once for the whole booking, so it is its
  // own line rather than being folded into a room's price.
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

  const doc = {
    kind: "receipt" as const,
    number: booking.reference,
    issuedOn: booking.createdAt.slice(0, 10),
    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`.trim(),
    customerEmail: to,
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
    viewUrl: `${req.nextUrl.origin}/receipt/${booking.id}`,
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
    await logActivity("Emailed receipt", `${booking.reference} to ${to}`);
  } catch (err) {
    console.error("logging receipt send failed:", err);
  }
  return NextResponse.json({ ok: true, to });
}
