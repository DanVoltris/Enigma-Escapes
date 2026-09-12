import { NextRequest, NextResponse } from "next/server";

// Content-Security-Policy, built fresh per request around a one-time nonce.
//
// Lives in proxy.ts, not middleware.ts: Next 16.3 renamed the convention and
// warns at build time on the old name.
//
// A nonce is the only way to get a real policy here. The app has inline
// scripts it genuinely needs — the locale handed to the browser before
// hydration, and the Google Tag Manager and Meta Pixel snippets — plus Next's
// own bootstrap. Allowing those with 'unsafe-inline' alone would permit every
// other inline script too, including one an attacker managed to inject, which
// is the whole thing a CSP is for. Instead each response carries a random
// nonce, the tags we wrote carry the matching attribute, and anything injected
// into the page can't guess it.
//
// 'strict-dynamic' lets a trusted script load further scripts. Tag Manager
// exists to inject tags, so without it turning GTM on would break the moment
// it did its job. The trade is explicit: whatever is configured in GTM is
// trusted, which is already true of anyone with access to the GTM account.
//
// The trailing `https:` and 'unsafe-inline' in script-src are NOT the loophole
// they look like. Any browser that understands nonces ignores both when a
// nonce is present — they exist only so a browser too old for CSP2 (IE11, iOS
// 9) degrades to loading the site rather than to a blank page. A booking site
// that silently breaks costs real money; the protection given up applies only
// to browsers that were ignoring the nonce anyway.
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
    // Inline style ATTRIBUTES (React's style={{…}}) can't carry a nonce, and
    // styling is a far weaker vector than script execution. Kept permissive on
    // purpose rather than pretending otherwise.
    "style-src 'self' 'unsafe-inline'",
    // Room posters are arbitrary URLs the owner pastes in Experiences, and the
    // Pixel's no-script fallback is an image on facebook.com. data: covers the
    // logo when it's stored inline.
    "img-src 'self' data: blob: https:",
    "font-src 'self'", // next/font self-hosts Source Sans 3 at build time
    "connect-src 'self' https:", // own APIs, plus analytics beacons when enabled
    // Only GTM's no-script fallback frame. Note for later: adopting Stripe
    // Elements (rather than the current redirect to hosted Checkout, which is a
    // top-level navigation and needs nothing here) would need js.stripe.com.
    "frame-src 'self' https://www.googletagmanager.com",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));
  const csp = buildCsp(nonce);

  // The nonce goes back in on the request so server components can read it and
  // stamp it onto the tags they render; Next reads the CSP header here too and
  // nonces its own bootstrap scripts off the back of it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except build output and static files: those are fixed assets
    // with no inline anything, and running this on each would add a per-asset
    // cost for no protection.
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
