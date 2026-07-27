"use client";

import { useEffect } from "react";
import { useCart } from "@/lib/cart";
import { trackPurchase } from "@/lib/tracking";

// Runs once on the confirmation page: fires the Purchase marketing event and
// empties the cart (the Stripe flow arrives here by redirect, so the cart
// can't be cleared client-side before leaving). sessionStorage guards against
// refreshes double-counting the conversion.
export default function ConfirmationEffects({ reference, totalCents }: { reference: string; totalCents: number }) {
  const { items, clear } = useCart();

  useEffect(() => {
    if (items.length > 0) clear();
  }, [items.length, clear]);

  useEffect(() => {
    if (!reference) return;
    const key = `vb-purchase-${reference}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // storage unavailable — still track, accepting possible double-count on refresh
    }
    trackPurchase(totalCents, reference);
  }, [reference, totalCents]);

  return null;
}
