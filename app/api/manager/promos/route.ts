import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { createPromo, getPromo, logActivity } from "@/lib/db";
import { PROMO_ROOMS_MIGRATION, parsePromoRooms } from "@/lib/promo-rooms";
import { promoOffLabel } from "@/lib/promo-label";

const PROMO_AMOUNT_MIGRATION =
  "Dollar-amount codes need migration 0020 (promo amount off) on this venue's database first.";

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
  const d = body as { code?: unknown; percentOff?: unknown; staffOnly?: unknown; rewardPercent?: unknown; rewardDays?: unknown; rewardMultiUse?: unknown; roomIds?: unknown; amountOff?: unknown };
  const staffOnly = d.staffOnly === true;

  const code = typeof d.code === "string" ? d.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{3,40}$/.test(code)) {
    return NextResponse.json(
      { error: "Codes are 3–40 letters and numbers, no spaces — e.g. SUMMER20." },
      { status: 400 }
    );
  }
  // A dollar code ($20 off the booking, before tax) when amountOff is sent;
  // otherwise a percentage. A dollar code stores percent_off as 0.
  const isAmount = d.amountOff !== undefined && d.amountOff !== null && d.amountOff !== "";
  const amountOff = Number(d.amountOff);
  const amountOffCents = isAmount ? Math.round(amountOff * 100) : 0;
  if (isAmount && (!Number.isFinite(amountOff) || amountOffCents < 1 || amountOffCents > 100000)) {
    return NextResponse.json({ error: "The dollar amount must be from $0.01 to $1,000 — e.g. 20." }, { status: 400 });
  }
  // Up to two decimal places: a $30.01 room (tax on top) only lands on a round
  // $25 at 16.69%, which no whole number reaches. The column is numeric.
  const percentOff = isAmount ? 0 : Number(d.percentOff);
  if (
    !isAmount &&
    (!Number.isFinite(percentOff) ||
    Math.round(percentOff * 100) / 100 !== percentOff ||
    percentOff < 0.01 ||
    percentOff > 100)
  ) {
    return NextResponse.json(
      { error: "Discount must be from 0.01 to 100 percent, with at most two decimal places — e.g. 10 or 16.69." },
      { status: 400 }
    );
  }

  let rooms: { ids: string[]; names: string[] } = { ids: [], names: [] };
  try {
    const parsed = await parsePromoRooms(d.roomIds);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    rooms = parsed;
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
      roomIds: rooms.ids,
      amountOffCents,
    });
    await logActivity(
      "Created promo code",
      `${code} — ${promoOffLabel({ percentOff, amountOffCents })}${rooms.names.length ? ` ${rooms.names.join(", ")} only` : ""}${staffOnly ? " (staff only)" : ""}` +
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
    if (isAmount && err instanceof Error && err.message.includes("amount_off_cents")) {
      return NextResponse.json({ error: PROMO_AMOUNT_MIGRATION }, { status: 500 });
    }
    if (rooms.ids.length > 0 && err instanceof Error && err.message.includes("room_ids")) {
      return NextResponse.json({ error: PROMO_ROOMS_MIGRATION }, { status: 500 });
    }
    return NextResponse.json(
      { error: "Could not save the code right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
