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

export function trackAddToCart(item: CartItem): void {
  const value = (item.priceCents * item.quantity) / 100;
  fb("AddToCart", { value, currency: currency(), content_name: item.roomName });
  gtm("add_to_cart", { value, currency: currency(), item_name: item.roomName, quantity: item.quantity });
}

export function trackInitiateCheckout(subtotalCents: number, numItems: number): void {
  const value = subtotalCents / 100;
  fb("InitiateCheckout", { value, currency: currency(), num_items: numItems });
  gtm("begin_checkout", { value, currency: currency(), num_items: numItems });
}

export function trackPurchase(totalCents: number, reference: string): void {
  const value = totalCents / 100;
  fb("Purchase", { value, currency: currency() });
  gtm("purchase", { value, currency: currency(), transaction_id: reference });
}
