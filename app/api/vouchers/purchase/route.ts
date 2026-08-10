import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/db";
import { activeTaxPercent } from "@/lib/taxes";
import { getPricingMode } from "@/lib/pricing-settings";
import { createPurchasedVoucher, isSellableAmount } from "@/lib/voucher-shop";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 || t.length > max ? null : t;
}

// Public: buy a gift voucher. The amount is re-checked against the sellable
// list here — a browser can ask for any number, and this is the only place a
// voucher gets minted.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  const amountCents = typeof o.amountCents === "number" ? Math.round(o.amountCents) : NaN;
  if (!isSellableAmount(amountCents)) {
    return NextResponse.json({ error: "That voucher amount isn't available. Pick one of the listed amounts." }, { status: 400 });
  }

  const buyerName = str(o.buyerName, 120);
  const buyerEmail = str(o.buyerEmail, 160);
  if (!buyerName) return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  if (!buyerEmail || !EMAIL_RE.test(buyerEmail)) {
    return NextResponse.json({ error: "Enter a valid email address, e.g. name@example.com." }, { status: 400 });
  }
  const recipientEmail = str(o.recipientEmail, 160);
  if (recipientEmail && !EMAIL_RE.test(recipientEmail)) {
    return NextResponse.json({ error: "That recipient email doesn't look right." }, { status: 400 });
  }

  try {
    const code = await createPurchasedVoucher({
      amountCents,
      buyerName,
      buyerEmail,
      recipientEmail,
      message: str(o.message, 400),
    });
    await logActivity("Gift voucher purchased", `${code} — $${(amountCents / 100).toFixed(2)} by ${buyerName}`);

    // The voucher is worth its face value; tax on a gift voucher is charged
    // when it's spent on a room, not when it's bought.
    const [taxPercent, mode] = await Promise.all([activeTaxPercent(), getPricingMode()]);
    return NextResponse.json({ code, amountCents, taxPercent, taxInclusive: mode.taxInclusive }, { status: 201 });
  } catch (err) {
    console.error("gift voucher purchase failed:", err);
    return NextResponse.json(
      { error: "Could not create your gift voucher right now. Nothing was charged — please try again." },
      { status: 500 }
    );
  }
}
