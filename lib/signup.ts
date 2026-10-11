// A business signs itself up (Phase 3).
//
// Runs before the business exists, on an address that is nobody's — so it
// cannot go through rest(), which needs a business. It calls the database's
// create_tenant and slug_available (migrations/0015) directly, with a token
// that names no business, exactly as the lookups in lib/tenant-resolve.ts do.
//
// Everything is validated here first, in plain words, and the database checks
// the parts that matter again. The password is hashed here and never leaves
// this process in the clear.

import { hashPassword, loginProblem, passwordProblem } from "./staff";
import { defaultPermissionsFor } from "./permissions";
import { signLookupToken, tenantAuthFromEnv, UUID_RE, type TenantAuth } from "./tenant-token";
import { normalizeUrl } from "./supabase";

/** New businesses live at <slug>.<PLATFORM_DOMAIN>. */
export const PLATFORM_DOMAIN = (process.env.PLATFORM_DOMAIN?.trim() || "voltrisbooking.com").toLowerCase();

export { RESERVED_SLUGS, SLUG_RE, slugFromName, slugProblem } from "./signup-rules";
import { slugProblem } from "./signup-rules";

export type SignupInput = {
  name: string;
  slug: string;
  ownerName: string;
  email: string;
  password: string;
  timezone: string;
};

const TIMEZONE_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;

/** First problem with the form, in plain words, or null. */
export function signupProblem(input: Partial<SignupInput>): string | null {
  const name = (input.name ?? "").trim();
  if (!name) return "Enter your business name.";
  if (name.length > 80) return "That business name is too long — 80 characters at most.";
  const slug = slugProblem(input.slug ?? "");
  if (slug) return slug;
  const owner = (input.ownerName ?? "").trim();
  if (!owner) return "Enter your name.";
  if (owner.length > 80) return "That name is too long — 80 characters at most.";
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return "Enter the email address you'll sign in with.";
  const login = loginProblem(email);
  if (login) return login;
  const pw = passwordProblem(input.password ?? "");
  if (pw) return pw;
  const tz = (input.timezone ?? "").trim();
  if (!tz || !TIMEZONE_RE.test(tz)) return "Choose your timezone.";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    return "That timezone isn't one we recognise.";
  }
  return null;
}

// Sign-ups per address, per instance, so one script can't mint businesses
// all afternoon. Per instance is a known limit (each server counts its own);
// the cheap deterrent, not the whole defence.
const WINDOW_MS = 60 * 60 * 1000;
const PER_WINDOW = 5;
const attempts = new Map<string, number[]>();
export function signupAllowed(ip: string, now = Date.now()): boolean {
  const key = ip || "unknown";
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_WINDOW) {
    attempts.set(key, recent);
    return false;
  }
  recent.push(now);
  attempts.set(key, recent);
  return true;
}

type Platform = { url: string; auth: TenantAuth };
function platform(): Platform {
  const url = normalizeUrl(process.env.SUPABASE_URL);
  const auth = tenantAuthFromEnv();
  if (!url || !auth) throw new Error("Sign-up is not configured on this deployment.");
  return { url, auth };
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { url, auth } = platform();
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: auth.apikey, Authorization: `Bearer ${signLookupToken(auth)}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  const body = await res.text();
  if (!res.ok) {
    // Postgres' own message, as PostgREST relays it: "slug_taken" and friends.
    let message = body;
    try {
      message = (JSON.parse(body) as { message?: string }).message ?? body;
    } catch {
      // not JSON — keep the text
    }
    throw new Error(message.slice(0, 200));
  }
  return JSON.parse(body) as T;
}

export async function slugAvailable(slug: string): Promise<boolean> {
  if (slugProblem(slug)) return false;
  return call<boolean>("slug_available", { p_slug: slug.trim().toLowerCase() });
}

export type SignupResult = { tenantId: string; host: string };

/** Creates the business. Throws with a plain-words message on refusal. */
export async function createBusiness(input: SignupInput): Promise<SignupResult> {
  const problem = signupProblem(input);
  if (problem) throw new Error(problem);
  const slug = input.slug.trim().toLowerCase();
  const host = `${slug}.${PLATFORM_DOMAIN}`;
  let tenantId: string;
  try {
    tenantId = await call<string>("create_tenant", {
      p_name: input.name.trim(),
      p_slug: slug,
      p_host: host,
      p_owner_name: input.ownerName.trim(),
      p_owner_email: input.email.trim().toLowerCase(),
      p_password_hash: hashPassword(input.password),
      p_permissions: defaultPermissionsFor("admin"),
      p_timezone: input.timezone.trim(),
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (/slug_taken|host_taken/.test(code)) throw new Error("That web address is already taken. Choose another.");
    if (/slug_invalid/.test(code)) throw new Error(slugProblem(slug) ?? "That web address isn't allowed.");
    throw new Error("Could not create your business right now. Please try again shortly.");
  }
  if (!UUID_RE.test(tenantId)) throw new Error("Could not create your business right now. Please try again shortly.");
  return { tenantId, host };
}
