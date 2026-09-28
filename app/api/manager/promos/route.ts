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
  const d = body as { code?: unknown; percentOff?: unknown; staffOnly?: unknown; rewardPercent?: unknown; rewardDays?: unknown; rewardMultiUse?: unknown };
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
    // A code can hand the customer a follow-up code with the confirmation —
    // "book with this and here's 20% off for a week". 0 = it grants nothing.
    const rewardPercent = Math.round(Number(d.rewardPercent ?? 0)) || 0;
    const rewardDays = Math.round(Number(d.rewardDays ?? 0)) || 0;
    if (rewardPercent < 0 || rewardPercent > 100) {
      return NextResponse.json(
        { error: "The follow-up discount must be between 1 and 100 percent." },
        { status: 400 }
      );
    }
    if (rewardPercent > 0 && (rewardDays < 1 || rewardDays > 365)) {
      return NextResponse.json(
        { error: "Say how many days the follow-up code lasts — 1 to 365." },
        { status: 400 }
      );
    }
    await createPromo({
      code,
      percentOff,
      active: true,
      staffOnly,
      rewardPercent,
      rewardDays,
      rewardMultiUse: rewardPercent > 0 && d.rewardMultiUse === true,
    });
    await logActivity(
      "Created promo code",
      `${code} — ${percentOff}% off${staffOnly ? " (staff only)" : ""}` +
        (rewardPercent > 0
          ? `, earns ${rewardPercent}% off for ${rewardDays} days${d.rewardMultiUse === true ? ", reusable" : ""}`
          : "")
    );
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
