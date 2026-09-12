"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CONSENT_COOKIE, CONSENT_DAYS, CONSENT_OPEN_EVENT, serializeConsent, type ConsentChoice } from "@/lib/consent";

const DAY = 24 * 60 * 60;

/**
 * The cookie banner, rendered only when a tracker is actually switched on.
 * With none configured — every venue's state until someone enables one — the
 * layout doesn't render this at all and no visitor ever sees a banner.
 *
 * `open` starts true when this visitor hasn't answered for the trackers that
 * are currently live. It can be reopened from the footer link at any time,
 * which is what makes withdrawing consent as easy as giving it.
 *
 * Answering reloads the page when the answer changes what the HTML should
 * contain — accepting when nothing is loaded, declining when something is.
 * It has to: the snippets are inline scripts rendered by the server, and a
 * <script> React inserts during a client update is never executed by the
 * browser. Reloading is also the only version certainly correct under the
 * site's Content-Security-Policy, since afterwards the scripts are the same
 * nonced, server-rendered tags as always. The cart is in localStorage, so it
 * survives the reload (lib/cart.tsx).
 */
export default function ConsentBanner({
  covers,
  initiallyOpen,
  loaded,
}: {
  /** Tracker keys currently live, stored with the answer. */
  covers: string[];
  /** Nothing answered yet for those trackers. */
  initiallyOpen: boolean;
  /** The tracking scripts are on this page, so declining has to undo them. */
  loaded: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  // The footer's "Cookie choices" link reopens it. A window event rather than
  // shared state: the link sits in the layout's footer, far from here, and this
  // is the only thing the two need to say to each other.
  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  // Escape closes the banner only once a choice exists — otherwise dismissal
  // would look like an answer, and "no answer" must never mean yes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !initiallyOpen) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, initiallyOpen]);

  const answer = useCallback(
    (choice: ConsentChoice) => {
      let stored = false;
      try {
        const value = encodeURIComponent(serializeConsent(choice, covers));
        document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${CONSENT_DAYS * DAY}; Path=/; SameSite=Lax`;
        stored = document.cookie.includes(`${CONSENT_COOKIE}=`);
      } catch {
        // Cookies blocked entirely.
      }
      if (!stored) {
        // Nothing could be saved, so nothing can be honoured on the next page
        // either. Say so rather than pretend the choice took.
        setOpen(false);
        window.alert(
          "Your browser is blocking cookies, so we can't record that choice. Nothing will be tracked, and we'll ask again next time."
        );
        return;
      }
      const wants = choice === "accepted";
      if (wants !== loaded) window.location.reload();
      else setOpen(false);
    },
    [covers, loaded]
  );

  if (!open) return null;

  return (
    // Deliberately not a modal: it doesn't trap focus or cover the page. A
    // banner that blocks the site until you answer isn't a free choice, and
    // this one sits on pages people are trying to buy from. Nothing is
    // autofocused either — focusing Accept would make a stray Enter consent on
    // someone's behalf, and would yank focus out of a half-filled form.
    <div className="consent-banner" role="region" aria-label="Cookie choices">
      <div className="consent-inner">
        <p className="consent-text">
          We&apos;d like to use advertising and analytics cookies to see which promotions bring people here. They
          aren&apos;t needed to book, and we won&apos;t use them unless you say yes.{" "}
          <Link href="/privacy" className="consent-link">
            What we collect
          </Link>
        </p>
        <div className="consent-actions">
          <button type="button" className="btn btn-outline consent-btn" onClick={() => answer("declined")}>
            Decline
          </button>
          <button type="button" className="btn consent-btn" onClick={() => answer("accepted")}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
