// Stripe Terminal: drives a physical card reader from the staff portal, so a
// press of "Send to terminal" puts the amount on the reader and the customer
// taps. Server-only, plain fetch (same approach as lib/stripe.ts).
//
// Requires STRIPE_SECRET_KEY. Without it every call here is refused politely
// and the portal falls back to recording payments by hand, exactly as before.
//
// Flow: create a card_present PaymentIntent → hand it to the reader → poll
// until the customer taps → record the payment on the booking.
import { stripeConfigured, stripeRequest } from "./stripe";

export type TerminalReader = {
  id: string;
  label: string;
  status: string; // "online" | "offline"
  deviceType: string;
  location: string | null; // Stripe location id (not our venue name)
};

export function terminalConfigured(): boolean {
  return stripeConfigured();
}

// Readers registered on the Stripe account, so staff can pick which reader
// sits at which of our venues.
export async function listReaders(): Promise<TerminalReader[]> {
  const data = await stripeRequest("GET", "/v1/terminal/readers?limit=100");
  const rows = (data.data as Record<string, unknown>[]) ?? [];
  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label ?? r.id),
    status: String(r.status ?? "unknown"),
    deviceType: String(r.device_type ?? ""),
    location: r.location ? String(r.location) : null,
  }));
}

// An in-person payment for this exact balance. Attaching the booking to
// metadata means a Stripe dashboard row can always be traced back here.
export async function createCardPresentIntent(
  amountCents: number,
  currency: string,
  meta: { bookingId: string; reference: string; payer: string }
): Promise<string> {
  const data = await stripeRequest("POST", "/v1/payment_intents", {
    amount: amountCents,
    currency: currency.toLowerCase(),
    payment_method_types: ["card_present"],
    capture_method: "automatic",
    description: `${meta.reference} — in person`,
    metadata: { bookingId: meta.bookingId, reference: meta.reference, payer: meta.payer },
  });
  return String(data.id);
}

// Wakes the reader: the amount appears on its screen and it waits for a tap.
export async function pushToReader(readerId: string, paymentIntentId: string): Promise<void> {
  await stripeRequest("POST", `/v1/terminal/readers/${encodeURIComponent(readerId)}/process_payment_intent`, {
    payment_intent: paymentIntentId,
  });
}

// Clears whatever the reader is showing (staff cancelled, or a retry).
export async function cancelReaderAction(readerId: string): Promise<void> {
  try {
    await stripeRequest("POST", `/v1/terminal/readers/${encodeURIComponent(readerId)}/cancel_action`);
  } catch {
    // Nothing in progress is a perfectly fine outcome for a cancel.
  }
}

export type IntentState = {
  status: string; // requires_payment_method | processing | succeeded | canceled …
  amountCents: number;
  lastError: string | null;
};

export async function getIntentState(paymentIntentId: string): Promise<IntentState> {
  const data = await stripeRequest("GET", `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`);
  const err = data.last_payment_error as { message?: string } | undefined;
  return {
    status: String(data.status ?? "unknown"),
    amountCents: Number(data.amount ?? 0),
    lastError: err?.message ?? null,
  };
}

export async function cancelIntent(paymentIntentId: string): Promise<void> {
  try {
    await stripeRequest("POST", `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`);
  } catch {
    // Already captured or gone — nothing to undo.
  }
}
