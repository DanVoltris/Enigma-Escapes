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

// Which business a request is for (lib/tenant-resolve.ts).
//
// A deployment pinned with VENUE_TENANT_ID serves one business and never looks
// anything up — Enigma and Time Zone today. Otherwise the request's web address
// names the business, or failing that the staff session (an app has no web
// address), or for the sign-in request itself the email being signed in with.
// The answer is stamped on the request as a header that lib/supabase.ts reads;
// whatever a client sent under that name is thrown away first, so nobody can
// name a business from outside.
//
// With no business and nothing signed in, only the sign-in screen and its API,
// the health check and the app manifest get through — the pieces that must
// work before a business is known. Everything else is "no venue here".
// Sign-up is here too: a business creating itself has no address yet.
const WITHOUT_BUSINESS = new Set([
  "/login", "/api/staff/login", "/api/health", "/staff.webmanifest",
  "/signup", "/api/signup", "/api/signup/slug",
]);

function noVenue(host: string): NextResponse {
  return new NextResponse(
    `<!doctype html><title>No venue at this address</title>` +
      `<body style="font-family:system-ui;margin:3rem;max-width:40rem"><h1>No venue at this address</h1>` +
      `<p>There's no booking site at <strong>${host.replace(/[<>&"]/g, "")}</strong>. ` +
      `Check the address you were given.</p></body>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

async function resolveBusiness(request: NextRequest): Promise<string | null | "pass"> {
  if (process.env.USE_LOCAL_DATA === "true" || process.env.USE_LOCAL_DATA === "1") return "pass";
  const pinned = process.env.VENUE_TENANT_ID?.trim();
  if (pinned) return pinned;

  const { tenantAuthFromEnv } = await import("./lib/tenant-token");
  const { tenantResolver } = await import("./lib/tenant-resolve");
  const { normalizeUrl } = await import("./lib/supabase");
  const auth = tenantAuthFromEnv();
  const url = normalizeUrl(process.env.SUPABASE_URL);
  if (!auth || !url) return "pass"; // unconfigured: the app says so itself, loudly
  const resolver = tenantResolver(url, auth);

  // The Host header only. x-forwarded-host can be set by a client, and a
  // header a client controls must never choose a business.
  const byHost = await resolver.forHost(request.headers.get("host"));
  if (byHost) return byHost;

  const bySession = await resolver.forSession(request.cookies.get("vb_staff")?.value);
  if (bySession) return bySession;

  if (request.method === "POST" && request.nextUrl.pathname === "/api/staff/login") {
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as { email?: unknown };
    const byEmail = await resolver.forStaffEmail(typeof body.email === "string" ? body.email : "");
    if (byEmail) return byEmail;
  }
  return null;
}

export async function proxy(request: NextRequest) {
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

  requestHeaders.delete("x-tenant-id");
  // A pinned deployment is one venue's own site. Sign-up there would create a
  // second business inside that venue's database, so it does not exist there.
  if (process.env.VENUE_TENANT_ID?.trim() && /^\/(signup|api\/signup)(\/|$)/.test(request.nextUrl.pathname)) {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const business = await resolveBusiness(request);
  if (business === null && !WITHOUT_BUSINESS.has(request.nextUrl.pathname)) {
    return noVenue(request.headers.get("host") ?? "");
  }
  if (business && business !== "pass") requestHeaders.set("x-tenant-id", business);

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
      source: "/((?!_next/static|_next/image|favicon.ico|sw.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
