// Client-side booking-funnel events for the marketing integrations. Each event
// goes to the Meta Pixel (if its script is loaded) and to the GTM dataLayer
// (if the container is loaded); with neither configured these are no-ops.
// Amounts arrive in cents and are reported in currency units.
import { localeConfig } from "./format";
import type { CartItem } from "./types";

type Fbq = (...args: unknown[]) => void;

declare global {
  interface Window {
    fbq?: Fbq;
    dataLayer?: Record<string, unknown>[];
  }
}

function currency(): string {
  return localeConfig().currencyCode;
}

function fb(event: string, data: Record<string, unknown>): void {
  if (typeof window !== "undefined" && typeof window.fbq === "function") window.fbq("track", event, data);
}

function gtm(event: string, data: Record<string, unknown>): void {
  if (typeof window !== "undefined" && Array.isArray(window.dataLayer)) window.dataLayer.push({ event, ...data });
}

// The venue's own record of the funnel, alongside whatever marketing tools are
// on. sendBeacon so the event survives the page changing underneath it — the
// purchase event fires on a page the customer is about to leave. Nothing about
// the person goes in the body; the server pairs it with the visitor cookie.
function firstParty(kind: string, props: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({ kind, props, path: window.location.pathname });
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/events", body);
    } else {
      void fetch("/api/events", { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } });
    }
  } catch {
    // never the customer's problem
  }
}

export function trackAddToCart(item: CartItem): void {
  const value = (item.priceCents * item.quantity) / 100;
  fb("AddToCart", { value, currency: currency(), content_name: item.roomName });
  gtm("add_to_cart", { value, currency: currency(), item_name: item.roomName, quantity: item.quantity });
  firstParty("add_to_cart", { room: item.roomName, cents: item.priceCents * item.quantity });
}

export function trackInitiateCheckout(subtotalCents: number, numItems: number): void {
  const value = subtotalCents / 100;
  fb("InitiateCheckout", { value, currency: currency(), num_items: numItems });
  gtm("begin_checkout", { value, currency: currency(), num_items: numItems });
  firstParty("begin_checkout", { cents: subtotalCents, items: numItems });
}

// The two steps between checkout and confirmation that the marketing tools
// never saw: details submitted, and the pay button pressed.
export function trackCheckoutDetails(): void {
  firstParty("checkout_details", {});
}

export function trackPaymentStarted(method: "stripe" | "simulated"): void {
  firstParty("payment_started", { method });
}

export function trackPurchase(totalCents: number, reference: string): void {
  const value = totalCents / 100;
  fb("Purchase", { value, currency: currency() });
  gtm("purchase", { value, currency: currency(), transaction_id: reference });
  firstParty("purchase", { cents: totalCents, reference });
}
