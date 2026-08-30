import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { createPromo, getPromo, logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

// Staff-only codes need a column the original table didn't have. Said in the
// error rather than a docs page, the way the Stripe and survey setup are.
export const STAFF_ONLY_MIGRATION =
  "Staff-only codes need a one-time database update. In Supabase → SQL editor run: " +
  "alter table promo_codes add column if not exists staff_only boolean not null default false;";

export async function POST(req: NextRequest) {
  const guard = await apiGuard("promos");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const d = body as { code?: unknown; percentOff?: unknown; staffOnly?: unknown };
  const staffOnly = d.staffOnly === true;

  const code = typeof d.code === "string" ? d.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{3,40}$/.test(code)) {
    return NextResponse.json(
      { error: "Codes are 3–40 letters and numbers, no spaces — e.g. SUMMER20." },
      { status: 400 }
    );
  }
  const percentOff = Number(d.percentOff);
  if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) {
    return NextResponse.json({ error: "Discount must be a whole number from 1 to 100 percent." }, { status: 400 });
  }

  try {
    if (await getPromo(code)) {
      return NextResponse.json({ error: `${code} already exists. Edit it in the list instead.` }, { status: 409 });
    }
    await createPromo({ code, percentOff, active: true, staffOnly });
    await logActivity("Created promo code", `${code} — ${percentOff}% off${staffOnly ? " (staff only)" : ""}`);
    return NextResponse.json({ code }, { status: 201 });
  } catch (err) {
    console.error("creating promo failed:", err);
    if (staffOnly && err instanceof Error && err.message.includes("staff_only")) {
      return NextResponse.json({ error: STAFF_ONLY_MIGRATION }, { status: 500 });
    }
    return NextResponse.json(
      { error: "Could not save the code right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
