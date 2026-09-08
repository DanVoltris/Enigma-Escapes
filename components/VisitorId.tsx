"use client";

import { useEffect } from "react";
import { VISITOR_COOKIE } from "@/lib/visitor";

// Gives the browser a random id so the usage record can tell "one person looked
// at five dates" from "five people looked at one". It is nothing but a random
// number: no name, no email, not linked to a booking, and the privacy page says
// so. Thirty days, then it rolls over.
export default function VisitorId() {
  useEffect(() => {
    try {
      if (document.cookie.split("; ").some((c) => c.startsWith(`${VISITOR_COOKIE}=`))) return;
      const id = crypto.randomUUID();
      document.cookie = `${VISITOR_COOKIE}=${id}; Max-Age=${30 * 24 * 60 * 60}; Path=/; SameSite=Lax`;
    } catch {
      // No cookies allowed — the record just has no visitor on it.
    }
  }, []);
  return null;
}
