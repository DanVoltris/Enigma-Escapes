import type { NextConfig } from "next";

// Sent on every response. These are the headers that cost nothing to set and
// close off a class of attack each; they are not a substitute for the
// server-side permission checks, which remain the actual security boundary.
//
// Strict-Transport-Security is deliberately absent: Vercel already serves
// `max-age=63072000` on this domain, and setting it here too would just send
// the header twice.
//
// Content-Security-Policy is deliberately absent as well, and is the one real
// gap left. The customer layout injects Google Tag Manager and the Meta Pixel
// as inline scripts (`dangerouslySetInnerHTML`), and Next's own hydration is
// inline too, so any policy loose enough to allow them needs 'unsafe-inline' —
// which is the very thing a CSP exists to forbid, making it decoration rather
// than defence. Doing it properly means per-request nonces through middleware
// and threading them into those tags: worth doing, but its own piece of work
// with its own testing, not a line in a config file.
const securityHeaders = [
  // Stop the browser second-guessing a declared Content-Type, which is how a
  // file uploaded as an image gets executed as a script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't let another site frame the app — clickjacking a signed-in manager
  // into clicking something under an invisible overlay.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Send the full URL only to ourselves. Booking URLs carry the booking id,
  // which is the customer's secret for managing it, so it must not travel in a
  // Referer header to an analytics or partner domain.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here needs a camera, a microphone or a location.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Drops `X-Powered-By: Next.js`. Not a vulnerability on its own — it just
  // saves telling every scanner which framework to try exploits for.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
