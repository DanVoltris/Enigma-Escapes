import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { createVoucherProduct } from "@/lib/voucher-products";

export const dynamic = "force-dynamic";

// Add a gift voucher customers can buy.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("promos");
  if (guard.response) return guard.response;

  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const dollars = typeof o.amount === "number" ? o.amount : Number(o.amount);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
  }
  const amountCents = Math.round(dollars * 100);
  if (amountCents > 100000) {
    return NextResponse.json({ error: "That's over $1,000 — too large to sell online." }, { status: 400 });
  }

  const name =
    typeof o.name === "string" && o.name.trim()
      ? o.name.trim().slice(0, 80)
      : `Gift Voucher for $${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
  const description =
    typeof o.description === "string" && o.description.trim()
      ? o.description.trim().slice(0, 240)
      : `Customers can purchase this voucher for a total value of $${(amountCents / 100).toFixed(2)}.`;

  try {
    const product = await createVoucherProduct({ name, amountCents, description });
    if (!product) {
      return NextResponse.json({ error: "There's already a voucher for that amount." }, { status: 409 });
    }
    await logActivity("Voucher product added", `${name} — $${(amountCents / 100).toFixed(2)}`);
    return NextResponse.json({ product }, { status: 201 });
  } catch (err) {
    console.error("creating voucher product failed:", err);
    return NextResponse.json({ error: "Could not add that voucher right now. Please try again." }, { status: 500 });
  }
}
