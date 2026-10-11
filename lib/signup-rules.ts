// The sign-up form's rules for a web address, shared by the form in the
// browser and the API on the server. Pure — no imports — so the client bundle
// takes only this, not lib/signup.ts and the server modules it reaches for.

export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

// Labels the platform uses or might, and a few that would mislead.
export const RESERVED_SLUGS = new Set([
  "www", "app", "api", "admin", "staging", "platform", "mail", "email", "smtp", "login", "signup", "sign-up",
  "voltris", "voltrisbooking", "support", "help", "status", "static", "assets", "cdn", "dev", "test", "demo",
  "billing", "dashboard", "manager", "portal", "docs", "blog",
]);

/** The address a business name suggests: "Enigma Escapes!" → "enigma-escapes". */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");
}

export function slugProblem(slug: string): string | null {
  const s = slug.trim().toLowerCase();
  if (!s) return "Choose a web address for your booking site.";
  if (s.length < 3) return "Use at least 3 characters.";
  if (!SLUG_RE.test(s)) return "Use lower-case letters, numbers and hyphens only, not starting or ending with a hyphen.";
  if (RESERVED_SLUGS.has(s)) return "That address is reserved. Choose another.";
  return null;
}
