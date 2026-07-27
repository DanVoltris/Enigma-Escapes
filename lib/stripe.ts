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

async function stripeRequest(method: "GET" | "POST", path: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
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

export type CheckoutSession = {
  id: string;
  payment_status: string;
  amount_total: number | null;
  metadata: Record<string, string> | null;
};

export async function retrieveCheckoutSession(id: string): Promise<CheckoutSession> {
  if (!/^cs_[a-zA-Z0-9_]+$/.test(id)) throw new Error("Invalid checkout session id.");
  const s = await stripeRequest("GET", `/v1/checkout/sessions/${id}`);
  return {
    id: s.id as string,
    payment_status: s.payment_status as string,
    amount_total: (s.amount_total as number | null) ?? null,
    metadata: (s.metadata as Record<string, string> | null) ?? null,
  };
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
