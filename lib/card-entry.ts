// Charging a card read out over the phone, from a booking's Payments tab.
//
// The number is typed into Stripe's own card box (Stripe.js, in an iframe), so
// it goes straight to Stripe and never reaches this server or the database —
// all we ever hold is the PaymentMethod id Stripe hands back. That is what
// keeps the business out of card-data compliance territory; the card box must
// never be swapped for plain inputs.
//
// Flagged as MOTO (mail order / telephone order): the cardholder isn't there to
// approve a bank's 3-D Secure check, and MOTO is how a card network is told so.
// Stripe has to switch MOTO on for the account first; until it has, Stripe
// refuses the flag, so the charge is retried without it — most cards still go
// through, and those whose bank insists on approval are declined with a
// message saying why.
import { stripeRequest } from "./stripe";

export type TypedCardResult =
  | { ok: true; intentId: string; amountCents: number; card: string | null }
  // final: Stripe gave an answer (declined, needs approval) — a fresh attempt
  // needs a fresh idempotency key. Otherwise we never heard back, and retrying
  // with the SAME key is what stops a double charge.
  | { ok: false; error: string; final: boolean };

function cardLabel(pi: Record<string, unknown>): string | null {
  const pm = pi.payment_method as Record<string, unknown> | undefined;
  const card = (pm?.card ?? {}) as Record<string, unknown>;
  const brand = typeof card.brand === "string" ? card.brand : null;
  const last4 = typeof card.last4 === "string" ? card.last4 : null;
  if (!brand && !last4) return null;
  const nice = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "Card";
  return last4 ? `${nice} •••• ${last4}` : nice;
}

export async function chargeTypedCard(
  paymentMethodId: string,
  amountCents: number,
  currency: string,
  meta: { bookingId: string; reference: string; staff: string },
  idempotencyKey: string
): Promise<TypedCardResult> {
  const params = (moto: boolean) => ({
    amount: amountCents,
    currency: currency.toLowerCase(),
    payment_method: paymentMethodId,
    payment_method_types: ["card"],
    confirm: true,
    ...(moto ? { payment_method_options: { card: { moto: true } } } : {}),
    description: `${meta.reference} — card taken by phone`,
    metadata: { bookingId: meta.bookingId, reference: meta.reference, takenBy: meta.staff },
    expand: ["payment_method"],
  });

  let pi: Record<string, unknown>;
  try {
    try {
      pi = await stripeRequest("POST", "/v1/payment_intents", params(true), `${idempotencyKey}-moto`);
    } catch (err) {
      if (!(err instanceof Error) || err instanceof TypeError || !/moto/i.test(err.message)) throw err;
      pi = await stripeRequest("POST", "/v1/payment_intents", params(false), idempotencyKey);
    }
  } catch (err) {
    // fetch itself failing is a TypeError: Stripe may or may not have charged.
    if (err instanceof TypeError || !(err instanceof Error)) {
      return { ok: false, error: "Couldn't reach Stripe. Press Charge again — the card won't be charged twice.", final: false };
    }
    return { ok: false, error: err.message, final: true };
  }

  const id = String(pi.id ?? "");
  const status = String(pi.status ?? "");
  if (status === "succeeded") {
    return { ok: true, intentId: id, amountCents: Number(pi.amount ?? amountCents), card: cardLabel(pi) };
  }
  // requires_action = the bank wants the cardholder to approve it themselves,
  // which can't happen over the phone. Cancel so nothing is left hanging.
  try {
    await stripeRequest("POST", `/v1/payment_intents/${encodeURIComponent(id)}/cancel`);
  } catch {
    // Already gone — nothing to undo.
  }
  if (status === "requires_action") {
    return {
      ok: false,
      error:
        "This card's bank wants the cardholder to approve the payment themselves, which can't be done over the phone. Take it on the card reader, or try another card.",
      final: true,
    };
  }
  const err = pi.last_payment_error as { message?: string } | undefined;
  return { ok: false, error: err?.message ?? "The card was not charged.", final: true };
}
