"use client";

import { useEffect } from "react";
import { trackPurchase } from "@/lib/tracking";

// Fires the Purchase event once per booking on the confirmation page.
// sessionStorage guards against refreshes double-counting the conversion.
export default function TrackPurchase({ reference, totalCents }: { reference: string; totalCents: number }) {
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
