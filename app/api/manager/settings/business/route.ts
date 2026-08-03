import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { saveSetting, type BusinessDetails } from "@/lib/settings";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PUT(req: NextRequest) {
  const guard = await apiGuard("settings");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const d = body as Partial<Record<keyof BusinessDetails, unknown>>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const details: BusinessDetails = {
    companyName: str(d.companyName, 120),
    phone: str(d.phone, 40),
    cell: str(d.cell, 40),
    email: str(d.email, 120),
    website: str(d.website, 200),
    taxLabel: str(d.taxLabel, 80),
    taxNumber: str(d.taxNumber, 40),
  };

  if (!details.companyName) {
    return NextResponse.json({ error: "Enter the company name." }, { status: 400 });
  }
  if (details.email && !EMAIL_RE.test(details.email)) {
    return NextResponse.json({ error: "That business email doesn't look right. Fix it or leave it blank." }, { status: 400 });
  }
  if (details.website && !/^https?:\/\/\S+$/.test(details.website)) {
    return NextResponse.json({ error: "The website should start with http:// or https://." }, { status: 400 });
  }

  try {
    await saveSetting("business_details", details);
    await logActivity("Updated business details", details.companyName);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save right now. Please try again.";
    console.error("saving business details failed:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
