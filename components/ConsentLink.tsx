"use client";

import { CONSENT_OPEN_EVENT } from "@/lib/consent";

// Footer link that reopens the banner. Rendered only when a tracker is live,
// so a site with no tracking has no cookie link to explain. Withdrawing has to
// be as easy as agreeing was, which means a way back that is always on screen.
export default function ConsentLink() {
  return (
    <button
      type="button"
      className="site-footer-link consent-reopen"
      onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
    >
      Cookie choices
    </button>
  );
}
