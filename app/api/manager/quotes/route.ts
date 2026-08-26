import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { isEmail } from "@/lib/email";
import { createQuote, type QuoteLine } from "@/lib/quotes";

export const dynamic = "force-dynamic";

// Raise an invoice for a customer who has not booked. Everything is validated
// here rather than trusted from the form — this document goes to a customer
// with a GST number on it.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("bookings.create");
  if (guard.response) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const customer = {
    name: str((b.customer as Record<string, unknown>)?.name, 120),
    email: str((b.customer as Record<string, unknown>)?.email, 200),
    phone: str((b.customer as Record<string, unknown>)?.phone, 40),
    company: str((b.customer as Record<string, unknown>)?.company, 160),
  };
  if (!customer.name) return NextResponse.json({ error: "Enter who the invoice is for." }, { status: 400 });
  if (!customer.email || !isEmail(customer.email)) {
    return NextResponse.json({ error: "Enter a valid email address to send the invoice to." }, { status: 400 });
  }

  const rawLines = Array.isArray(b.lines) ? b.lines : [];
  const lines: QuoteLine[] = [];
  for (const raw of rawLines.slice(0, 40)) {
    const l = raw as Record<string, unknown>;
    const roomName = str(l.roomName, 160);
    if (!roomName) continue;
    const quantity = Math.round(Number(l.quantity));
    const unitCents = Math.round(Number(l.unitCents));
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 999) {
      return NextResponse.json({ error: `"${roomName}" needs a quantity between 1 and 999.` }, { status: 400 });
    }
    if (!Number.isFinite(unitCents) || unitCents < 0 || unitCents > 100_000_00) {
      return NextResponse.json({ error: `"${roomName}" needs a price between $0 and $100,000.` }, { status: 400 });
    }
    lines.push({
      roomName,
      location: str(l.location, 120),
      date: str(l.date, 10) || null,
      time: str(l.time, 5) || null,
      quantity,
      unitCents,
    });
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: "Add at least one line to the invoice." }, { status: 400 });
  }

  const discountCents = Math.max(0, Math.round(Number(b.discountCents) || 0));
  const taxPercent = Number(b.taxPercent);
  if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
    return NextResponse.json({ error: "The tax rate must be between 0 and 100." }, { status: 400 });
  }

  try {
    const quote = await createQuote({
      customer,
      lines,
      discountCents,
      taxPercent,
      note: str(b.note, 2000),
      expiresOn: str(b.expiresOn, 10) || null,
      createdBy: guard.staff.name,
    });
    await logActivity("Raised invoice", `${quote.number} for ${customer.name}`);
    return NextResponse.json({ ok: true, id: quote.id, number: quote.number });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save the invoice. Please try again.";
    console.error("creating quote failed:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
