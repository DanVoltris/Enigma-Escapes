// Server-only Stripe access via plain fetch (same no-SDK approach as
// lib/supabase.ts). Keys live in environment variables ONLY — never in the
// settings table, because the manager portal has no login yet. A restricted
// key (rk_...) with Checkout Session write access is recommended over a full
// secret key.
import { createHmac, timingSafeEqual } from "crypto";
import type { Booking } from "./types";

const KEY = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const API_VERSION = "2026-05-27.dahlia";

// How long an unpaid checkout holds its spots. Also the Stripe session expiry
// (30 minutes is the minimum Stripe allows).
export const PENDING_MINUTES = 30;

export function stripeConfigured(): boolean {
  return typeof KEY === "string" && KEY.length > 0;
}

// "test" | "live" | null — shown on the integrations page.
export function stripeMode(): "test" | "live" | null {
  if (!KEY) return null;
  return KEY.includes("_live_") ? "live" : "test";
}

export function webhookConfigured(): boolean {
  return typeof WEBHOOK_SECRET === "string" && WEBHOOK_SECRET.length > 0;
}

// Flatten nested params into Stripe's bracketed form encoding,
// e.g. line_items[0][price_data][unit_amount]=3000.
function encodeForm(value: unknown, prefix: string, out: URLSearchParams): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => encodeForm(v, `${prefix}[${i}]`, out));
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      encodeForm(v, prefix ? `${prefix}[${k}]` : k, out);
    }
  } else {
    out.append(prefix, String(value));
  }
}

export async function stripeRequest(method: "GET" | "POST", path: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!KEY) throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY in the environment.");
  const body = new URLSearchParams();
  if (params) encodeForm(params, "", body);
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Stripe-Version": API_VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body.toString() : undefined,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (data.error as { message?: string } | undefined)?.message ?? `Stripe request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// Hosted Checkout Session for the amount due now (full or deposit).
// payment_method_types is intentionally omitted so Stripe shows each customer
// the most relevant payment methods (managed from the Stripe Dashboard).
export async function createCheckoutSession(
  booking: Booking,
  dueCents: number,
  currencyCode: string,
  origin: string
): Promise<{ id: string; url: string }> {
  const label =
    booking.paymentOption === "deposit"
      ? `Escape room booking ${booking.reference} — deposit`
      : `Escape room booking ${booking.reference}`;
  const session = await stripeRequest("POST", "/v1/checkout/sessions", {
    mode: "payment",
    client_reference_id: booking.id,
    customer_email: booking.customer.email,
    metadata: { bookingId: booking.id },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: currencyCode.toLowerCase(),
          unit_amount: dueCents,
          product_data: { name: label },
        },
      },
    ],
    // {CHECKOUT_SESSION_ID} is substituted by Stripe on redirect.
    success_url: `${origin}/confirmation/${booking.id}?sid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout/payment?canceled=1`,
    expires_at: Math.floor(Date.now() / 1000) + PENDING_MINUTES * 60,
  });
  return { id: session.id as string, url: session.url as string };
}

// Hosted Checkout for a gift voucher. The buyer's details ride along in
// metadata so the voucher can be minted after payment clears — nothing is
// issued until Stripe says the money arrived.
export async function createVoucherCheckoutSession(
  input: {
    amountCents: number;
    productName: string;
    buyerName: string;
    buyerEmail: string;
    recipientEmail: string | null;
    message: string | null;
  },
  currencyCode: string,
  origin: string
): Promise<{ id: string; url: string }> {
  const session = await stripeRequest("POST", "/v1/checkout/sessions", {
    mode: "payment",
    customer_email: input.buyerEmail,
    metadata: {
      kind: "voucher",
      amountCents: String(input.amountCents),
      buyerName: input.buyerName,
      buyerEmail: input.buyerEmail,
      recipientEmail: input.recipientEmail ?? "",
      // Stripe caps a metadata value at 500 characters.
      message: (input.message ?? "").slice(0, 480),
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: currencyCode.toLowerCase(),
          unit_amount: input.amountCents,
          product_data: { name: input.productName },
        },
      },
    ],
    success_url: `${origin}/gift-vouchers/done?sid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/gift-vouchers?canceled=1`,
  });
  return { id: session.id as string, url: session.url as string };
}

export type CheckoutSession = {
  id: string;
  payment_status: string;
  amount_total: number | null;
  metadata: Record<string, string> | null;
  payment_intent: string | null; // kept on the booking so refunds have a target
};

export async function retrieveCheckoutSession(id: string): Promise<CheckoutSession> {
  if (!/^cs_[a-zA-Z0-9_]+$/.test(id)) throw new Error("Invalid checkout session id.");
  const s = await stripeRequest("GET", `/v1/checkout/sessions/${id}`);
  return {
    id: s.id as string,
    payment_status: s.payment_status as string,
    amount_total: (s.amount_total as number | null) ?? null,
    metadata: (s.metadata as Record<string, string> | null) ?? null,
    payment_intent: typeof s.payment_intent === "string" ? s.payment_intent : null,
  };
}

// Refunds a payment in full or part. Returns the refunded amount in cents, or
// null when Stripe is not configured (nothing was ever really charged).
export async function refundPayment(paymentIntentId: string, amountCents: number): Promise<number | null> {
  if (!stripeConfigured()) return null;
  if (!/^pi_[a-zA-Z0-9_]+$/.test(paymentIntentId)) throw new Error("Invalid payment id.");
  if (amountCents <= 0) return 0;
  const r = await stripeRequest("POST", "/v1/refunds", { payment_intent: paymentIntentId, amount: amountCents });
  return typeof r.amount === "number" ? r.amount : amountCents;
}

// What card actually paid, for a card-reader payment: "Visa •••• 4242". A party
// often pays on several cards, and a refund has to go back to the right one —
// an amount and a time is not enough for a staff member to tell them apart.
// Returns null when Stripe can't say (or isn't configured); the caller then
// falls back to whatever the payment record itself knows.
export async function cardForPayment(paymentIntentId: string): Promise<string | null> {
  if (!stripeConfigured()) return null;
  if (!/^pi_[a-zA-Z0-9_]+$/.test(paymentIntentId)) return null;
  try {
    const pi = await stripeRequest("GET", `/v1/payment_intents/${paymentIntentId}?expand[]=latest_charge`);
    const charge = pi.latest_charge as Record<string, unknown> | undefined;
    const details = (charge?.payment_method_details ?? {}) as Record<string, unknown>;
    const card = (details.card_present ?? details.card ?? {}) as Record<string, unknown>;
    const brand = typeof card.brand === "string" ? card.brand : null;
    const last4 = typeof card.last4 === "string" ? card.last4 : null;
    if (!brand && !last4) return null;
    const nice = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "Card";
    return last4 ? `${nice} •••• ${last4}` : nice;
  } catch (err) {
    console.error("looking up the card behind a payment failed:", err);
    return null;
  }
}

// Verifies a Stripe webhook signature header ("t=...,v1=...") against the raw
// request body. Tolerates 5 minutes of clock skew, like Stripe's SDKs.
export function verifyStripeWebhook(payload: string, sigHeader: string | null): boolean {
  if (!WEBHOOK_SECRET || !sigHeader) return false;
  const parts = new Map<string, string[]>();
  for (const piece of sigHeader.split(",")) {
    const [k, v] = piece.split("=", 2);
    if (!k || !v) continue;
    const key = k.trim();
    parts.set(key, [...(parts.get(key) ?? []), v.trim()]);
  }
  const t = parts.get("t")?.[0];
  const signatures = parts.get("v1") ?? [];
  if (!t || signatures.length === 0) return false;
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${payload}`).digest("hex");
  const expectedBuf = Buffer.from(expected);
  return signatures.some((sig) => {
    const buf = Buffer.from(sig);
    return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf);
  });
}
