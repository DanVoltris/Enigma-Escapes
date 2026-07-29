import { NextRequest, NextResponse } from "next/server";
import { upsertManualCustomer } from "@/lib/customers";
import { logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const firstName = typeof o.firstName === "string" ? o.firstName.trim().slice(0, 60) : "";
  const lastName = typeof o.lastName === "string" ? o.lastName.trim().slice(0, 60) : "";
  const email = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
  const phone = typeof o.phone === "string" ? o.phone.trim().slice(0, 30) : "";
  if (!firstName || !lastName) return NextResponse.json({ error: "Enter the customer's first and last name." }, { status: 400 });
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address — it's how customers are grouped." }, { status: 400 });
  }

  try {
    await upsertManualCustomer({
      email,
      firstName,
      lastName,
      phone,
      subscribe: o.subscribe === true,
      createdAt: new Date().toISOString(),
    });
    await logActivity("Customer added", `${firstName} ${lastName} (${email})`);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save the customer right now. Please try again.";
    console.error("adding customer failed:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
