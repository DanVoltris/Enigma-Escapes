import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/db";
import { getLocale } from "@/lib/locale";
import { createVoucherCheckoutSession, stripeConfigured } from "@/lib/stripe";
import { createPurchasedVoucher, voucherAmountRules } from "@/lib/voucher-shop";
import { getProductByAmount, listVoucherProducts } from "@/lib/voucher-products";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 || t.length > max ? null : t;
}

// Public: buy a gift voucher for whatever the buyer types. The amount is
// re-checked against the venue's own minimum here — a browser can ask for any
// number, and this is the only place a voucher gets minted.
//
// With Stripe configured this returns a hosted-checkout URL and issues
// nothing; the voucher is minted only once Stripe confirms payment. Without
// Stripe it falls back to the same simulated payment the booking flow uses.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  // Switching every amount off on the Gift vouchers tab closes the online shop,
  // which the page honours — and so must this, or the closed shop would still
  // sell to anyone who posted here directly.
  if ((await listVoucherProducts({ activeOnly: true })).length === 0) {
    return NextResponse.json(
      { error: "Gift vouchers aren't on sale online just now — please give us a call." },
      { status: 400 }
    );
  }

  const rules = await voucherAmountRules();
  const amountCents = typeof o.amountCents === "number" ? Math.round(o.amountCents) : NaN;
  if (!Number.isInteger(amountCents) || amountCents < rules.minCents || amountCents > rules.maxCents) {
    return NextResponse.json(
      {
        error: `A gift voucher has to be between $${(rules.minCents / 100).toFixed(2)} and $${(
          rules.maxCents / 100
        ).toFixed(2)}.`,
      },
      { status: 400 }
    );
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
  const message = str(o.message, 400);

  try {
    if (stripeConfigured()) {
      const product = await getProductByAmount(amountCents);
      const { currencyCode } = await getLocale();
      const session = await createVoucherCheckoutSession(
        {
          amountCents,
          productName: product?.name ?? `Gift Voucher for $${(amountCents / 100).toFixed(2)}`,
          buyerName,
          buyerEmail,
          recipientEmail,
          message,
        },
        currencyCode,
        req.nextUrl.origin
      );
      return NextResponse.json({ url: session.url }, { status: 200 });
    }

    const code = await createPurchasedVoucher({ amountCents, buyerName, buyerEmail, recipientEmail, message });
    await logActivity("Gift voucher purchased", `${code} — $${(amountCents / 100).toFixed(2)} by ${buyerName}`);
    return NextResponse.json({ code, amountCents }, { status: 201 });
  } catch (err) {
    console.error("gift voucher purchase failed:", err);
    return NextResponse.json(
      { error: "Could not start your gift voucher purchase. Nothing was charged — please try again." },
      { status: 500 }
    );
  }
}
