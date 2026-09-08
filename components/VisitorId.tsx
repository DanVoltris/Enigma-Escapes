"use client";

import { useEffect } from "react";
import { ATTRIBUTION_COOKIE, ATTRIBUTION_DAYS, parseAttribution } from "@/lib/attribution";
import { VISITOR_COOKIE } from "@/lib/visitor";

const DAY = 24 * 60 * 60;

function has(name: string): boolean {
  return document.cookie.split("; ").some((c) => c.startsWith(`${name}=`));
}

function set(name: string, value: string, days: number): void {
  document.cookie = `${name}=${value}; Max-Age=${days * DAY}; Path=/; SameSite=Lax`;
}

// Two cookies, both set once and neither about the person.
//
// The visitor id is a random number so the usage record can tell "one person
// looked at five dates" from "five people looked at one". Thirty days.
//
// The attribution cookie remembers how they first arrived — utm parameters,
// the referring site's host, the page they landed on — so a booking made later
// can be credited to the post that brought them. First touch only: once set it
// is left alone, so a return visit by typing the address doesn't overwrite the
// campaign that did the work. Ninety days. The privacy page describes both.
export default function VisitorId() {
  useEffect(() => {
    try {
      if (!has(VISITOR_COOKIE)) set(VISITOR_COOKIE, crypto.randomUUID(), 30);
      if (!has(ATTRIBUTION_COOKIE)) {
        const q = new URLSearchParams(window.location.search);
        let referrer: string | undefined;
        try {
          const r = document.referrer ? new URL(document.referrer).host : "";
          if (r && r !== window.location.host) referrer = r;
        } catch {
          // unparsable referrer — leave it out
        }
        const found = parseAttribution({
          source: q.get("utm_source") ?? undefined,
          medium: q.get("utm_medium") ?? undefined,
          campaign: q.get("utm_campaign") ?? undefined,
          content: q.get("utm_content") ?? undefined,
          term: q.get("utm_term") ?? undefined,
          referrer,
          landing: window.location.pathname,
          at: new Date().toISOString(),
        });
        // Only worth keeping if it says something about where they came from.
        // A plain direct visit with no referrer gets no cookie, and is reported
        // as Direct when it books.
        if (found && (found.source || found.referrer)) {
          set(ATTRIBUTION_COOKIE, encodeURIComponent(JSON.stringify(found)), ATTRIBUTION_DAYS);
        }
      }
    } catch {
      // Cookies blocked — the record simply has no visitor or origin on it.
    }
  }, []);
  return null;
}
