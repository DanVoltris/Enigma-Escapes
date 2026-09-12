// Cookie consent for the marketing trackers. Pure module — no imports — so the
// client banner and the server layout can share it without dragging server code
// into the browser bundle (same pattern as lib/visitor.ts and lib/integrations.ts).
//
// The decision lives in a cookie rather than localStorage on purpose: the
// server layout reads it while rendering, so a page either ships the tracking
// snippets or doesn't. Nothing is ever injected into a page after load. That
// keeps the nonce-based CSP honest — the snippets stay exactly the inline,
// nonced scripts they already are — and means a declining visitor never has
// the scripts in their HTML at all, rather than having them loaded and then
// asked to behave.
//
// Nothing here is about the person. The value records a choice, not an identity.

export const CONSENT_COOKIE = "vb_consent";
export const CONSENT_DAYS = 180;

// Fired on window by the footer link to reopen the banner. Here rather than in
// either component because both sides need the same string.
export const CONSENT_OPEN_EVENT = "vb:consent-open";

export type ConsentChoice = "accepted" | "declined";

export type Consent = {
  choice: ConsentChoice;
  // Which trackers the visitor was actually asked about. A venue that switches
  // a new one on later is asking a new question, so the banner comes back —
  // for people who accepted and people who declined alike. Consent to the Pixel
  // is not consent to whatever is added next.
  covers: string[];
};

// Cookie text is attacker-controllable (anyone can edit their own), so this
// parses strictly and returns null on anything it doesn't recognise — which
// shows the banner again, the safe direction to fail.
export function parseConsent(raw: string | undefined | null): Consent | null {
  if (!raw) return null;
  const [choice, list = ""] = decodeURIComponent(raw).split(":");
  if (choice !== "accepted" && choice !== "declined") return null;
  const covers = list.split(",").filter((k) => k === "fb" || k === "gtm");
  return { choice, covers };
}

export function serializeConsent(choice: ConsentChoice, covers: string[]): string {
  return `${choice}:${[...covers].sort().join(",")}`;
}

// The trackers switched on right now, as stable keys. Takes the result of
// activeTrackers() rather than the settings, so "configured but switched off"
// and "switched on but the ID failed validation" are already resolved — a
// tracker that cannot run is not something to ask about.
export function trackerKeys(active: { fb: boolean; gtm: boolean }): string[] {
  const keys: string[] = [];
  if (active.fb) keys.push("fb");
  if (active.gtm) keys.push("gtm");
  return keys;
}

export type ConsentState = {
  /** Any tracker is live, so there is something to ask about at all. */
  required: boolean;
  /** Show the banner: something is live that this visitor hasn't answered for. */
  ask: boolean;
  /** Render the tracking snippets on this response. */
  allow: boolean;
};

// The whole decision, in one place, so the layout and the privacy page can't
// drift apart on what counts as consent.
export function consentState(active: { fb: boolean; gtm: boolean }, stored: Consent | null): ConsentState {
  const live = trackerKeys(active);
  if (live.length === 0) {
    // Nothing to consent to: no banner, nothing to load. This is the state
    // every venue is in until someone switches a tracker on.
    return { required: false, ask: false, allow: false };
  }
  const answered = stored !== null && live.every((k) => stored.covers.includes(k));
  return {
    required: true,
    ask: !answered,
    allow: answered && stored.choice === "accepted",
  };
}
