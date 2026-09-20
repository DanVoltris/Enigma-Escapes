// Stripe Terminal: drives a physical card reader from the staff portal, so a
// press of "Send to terminal" puts the amount on the reader and the customer
// taps. Server-only, plain fetch (same approach as lib/stripe.ts).
//
// Requires STRIPE_SECRET_KEY. Without it every call here is refused politely
// and the portal falls back to recording payments by hand, exactly as before.
//
// Flow: create a card_present PaymentIntent → hand it to the reader → poll
// until the customer taps → record the payment on the booking.
import { randomUUID } from "crypto";
import { getBooking, logActivity, updateBookingFields } from "./db";
import { formatMoney } from "./format";
import { stripeConfigured, stripeRequest } from "./stripe";
import type { Booking, BookingPayment } from "./types";

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

// Writes a reader payment Stripe says succeeded onto the booking — once, keyed
// on the intent id, however many times it's asked. Shared by the Today screen's
// poll and its Cancel button: a tap that lands as staff cancel, or after the
// poll has stopped, is still money taken, and leaving it off the booking showed
// the balance as due and invited a second charge.
export async function recordReaderPayment(
  bookingId: string,
  paymentIntentId: string,
  amountCents: number,
  payer: string
): Promise<{ booking: Booking; pricing: Booking["pricing"] | null } | undefined> {
  const booking = await getBooking(bookingId);
  if (!booking) return undefined;
  if ((booking.pricing.payments ?? []).some((p) => p.intentId === paymentIntentId)) {
    return { booking, pricing: null };
  }
  const payment: BookingPayment = {
    id: randomUUID(),
    method: "card",
    amountCents,
    payer: payer.trim().slice(0, 60) || null,
    note: "Card reader",
    at: new Date().toISOString(),
    intentId: paymentIntentId,
  };
  const pricing = {
    ...booking.pricing,
    paidCents: booking.pricing.paidCents + payment.amountCents,
    balanceCents: Math.max(0, booking.pricing.balanceCents - payment.amountCents),
    payments: [...(booking.pricing.payments ?? []), payment],
  };
  await updateBookingFields(bookingId, { pricing });
  await logActivity("Card payment taken", `${formatMoney(payment.amountCents)} on ${booking.reference} (reader)`);
  return { booking, pricing };
}

export async function cancelIntent(paymentIntentId: string): Promise<void> {
  try {
    await stripeRequest("POST", `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`);
  } catch {
    // Already captured or gone — nothing to undo.
  }
}
