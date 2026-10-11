import { createHash } from "crypto";
import { signLookupToken, UUID_RE, type TenantAuth } from "./tenant-token";

// Which business a request is for, worked out before any of its data is read.
//
// Three ways, tried in this order by proxy.ts:
//   1. the web address      enigmaescapes.voltrisbooking.com → Enigma
//   2. the staff session    a signed-in member of staff names their business —
//                           this is how an app with no web address works
//   3. a staff sign-in      the email being signed in with, for the sign-in
//                           request itself, if exactly one business has it
// Each is a database function (migrations/0014) called with a token that names
// no business, and each answers with a tenant id or nothing. The answer for a
// web address is kept for a few minutes: it changes rarely and every request
// asks.
//
// Pure module apart from node's crypto, so the lookups can be tested with a
// stand-in fetch.

/** The request header proxy.ts stamps the resolved business onto. */
export const TENANT_HEADER = "x-tenant-id";

const HOST_CACHE_SECONDS = 300;
const hostCache = new Map<string, { tenantId: string | null; expires: number }>();

export function normalizeHost(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().split(":")[0];
}

type Lookup = (fn: string, args: Record<string, string>) => Promise<string | null>;

function lookupVia(supabaseUrl: string, auth: TenantAuth, fetchFn: typeof fetch): Lookup {
  return async (fn, args) => {
    const res = await fetchFn(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: auth.apikey,
        Authorization: `Bearer ${signLookupToken(auth)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${fn} failed (Supabase ${res.status})`);
    const value: unknown = await res.json();
    return typeof value === "string" && UUID_RE.test(value) ? value : null;
  };
}

export type Resolver = {
  forHost(host: string | null | undefined): Promise<string | null>;
  forSession(cookieToken: string | null | undefined): Promise<string | null>;
  forStaffEmail(email: string | null | undefined): Promise<string | null>;
};

export function tenantResolver(
  supabaseUrl: string,
  auth: TenantAuth,
  { fetchFn = fetch, now = () => Date.now() }: { fetchFn?: typeof fetch; now?: () => number } = {}
): Resolver {
  const lookup = lookupVia(supabaseUrl, auth, fetchFn);
  return {
    async forHost(raw) {
      const host = normalizeHost(raw);
      if (!host) return null;
      const hit = hostCache.get(host);
      if (hit && hit.expires > now()) return hit.tenantId;
      const tenantId = await lookup("tenant_for_host", { p_host: host });
      hostCache.set(host, { tenantId, expires: now() + HOST_CACHE_SECONDS * 1000 });
      return tenantId;
    },
    async forSession(cookieToken) {
      if (!cookieToken) return null;
      // Only the hash is ever stored or sent (lib/staff.ts).
      return lookup("tenant_for_session", { p_token_hash: createHash("sha256").update(cookieToken).digest("hex") });
    },
    async forStaffEmail(email) {
      const clean = (email ?? "").trim();
      if (!clean || clean.length > 200) return null;
      return lookup("tenant_for_staff_email", { p_email: clean });
    },
  };
}

/** For tests: forget cached addresses. */
export function forgetHosts(): void {
  hostCache.clear();
}
