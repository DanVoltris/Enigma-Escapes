import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { createStaffCode } from "@/lib/voucher-shop";
import { listVoucherPage } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

// Same shape the old system enforced: letters, numbers and hyphens, no spaces.
const CODE_RE = /^[A-Z0-9-]{3,40}$/;

// Create a staff-issued code — a giveaway, apology or prize. It's a dollar
// balance like any voucher, so it lands in the same table and gets the same
// rules screen; it's filed under Promo codes because that's where staff look.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("promos");
  if (guard.response) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  const dollars = typeof o.amount === "number" ? o.amount : Number(o.amount);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
  }
  const amountCents = Math.round(dollars * 100);
  if (amountCents > 100000) {
    return NextResponse.json({ error: "That's over $1,000 — create it in smaller codes." }, { status: 400 });
  }

  let code: string | undefined;
  if (typeof o.code === "string" && o.code.trim() !== "") {
    code = o.code.trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      return NextResponse.json(
        { error: "Codes can use letters, numbers and hyphens only — no spaces." },
        { status: 400 }
      );
    }
  }

  const note = typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 200) : null;

  try {
    const created = await createStaffCode({
      code,
      amountCents,
      note,
      createdBy: guard.staff.name || guard.staff.email,
    });
    if (!created) {
      return NextResponse.json({ error: "That code already exists. Pick another." }, { status: 409 });
    }
    await logActivity("Staff code created", `${created} — $${dollars.toFixed(2)}`);
    return NextResponse.json({ code: created }, { status: 201 });
  } catch (err) {
    console.error("creating staff code failed:", err);
    return NextResponse.json({ error: "Could not create that code right now. Please try again." }, { status: 500 });
  }
}

// Paged, filtered voucher list. The browser asks for a page at a time instead
// of holding the whole table.
export async function GET(req: NextRequest) {
  const guard = await apiGuard("promos");
  if (guard.response) return guard.response;
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "all";
  try {
    const page = await listVoucherPage({
      q: sp.get("q") ?? "",
      status: (["all", "active", "inactive", "unspent", "partial", "spent"] as const).includes(
        status as never
      )
        ? (status as "all")
        : "all",
      limit: Number(sp.get("limit")) || 60,
      offset: Number(sp.get("offset")) || 0,
    });
    return NextResponse.json(page);
  } catch (err) {
    console.error("listing vouchers failed:", err);
    return NextResponse.json({ error: "Could not load vouchers right now. Please try again." }, { status: 500 });
  }
}
