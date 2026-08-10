import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/db";
import { getLocale } from "@/lib/locale";
import { createVoucherCheckoutSession, stripeConfigured } from "@/lib/stripe";
import { createPurchasedVoucher, isSellableAmount } from "@/lib/voucher-shop";
import { VOUCHER_PRODUCTS } from "@/lib/voucher-shop-config";

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

  const amountCents = typeof o.amountCents === "number" ? Math.round(o.amountCents) : NaN;
  if (!isSellableAmount(amountCents)) {
    return NextResponse.json(
      { error: "That voucher amount isn't available. Pick one of the listed amounts." },
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
      const product = VOUCHER_PRODUCTS.find((p) => p.cents === amountCents);
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
