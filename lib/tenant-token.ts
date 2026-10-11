import { createHmac } from "crypto";

// How a request tells the database which business it is for.
//
// Row level security (migrations/0004) keeps the tenant_app role to the rows of
// one business, named by the verified JWT the request carries. This signs that
// JWT: { role: "tenant_app", tenant_id }, HS256, a minute long, with a shared
// secret imported into the Supabase project as a JWT signing key. The Data API
// verifies it, switches to tenant_app, and hands the claims to Postgres for
// that request only.
//
// Which business goes in the token comes from one of two places:
//   - VENUE_TENANT_ID, when set: the deployment is pinned to one business. How
//     Enigma and Time Zone run, each on its own database.
//   - Otherwise the request itself — its web address, or the staff session —
//     resolved by proxy.ts (lib/tenant-resolve.ts) and stamped on the request.
//     How a deployment serving many businesses runs.
// The lookups that resolve a business need a token too, one that names no
// business yet: signLookupToken. The database functions it may call return a
// tenant id and nothing else (migrations/0014).
//
// Required settings: SUPABASE_PUBLISHABLE_KEY (sent as apikey) and
// SUPABASE_JWT_SECRET. With neither it refuses; with only one it refuses and
// says which is missing — a half-configured venue must be loud, never quiet.
//
// Pure module (only node's crypto) so tests can load it without Next.

export type TenantAuth = {
  apikey: string;
  secret: string;
  /** VENUE_TENANT_ID: this deployment serves one business only. */
  pinnedTenantId?: string;
  kid?: string; // SUPABASE_JWT_KID, if the project needs the signing key named in the header
};

export const TOKEN_TTL_SECONDS = 60;
// A token is reused until this close to expiry, then re-signed.
const REFRESH_BEFORE_SECONDS = 20;
// HS256 is only as strong as its secret; anything shorter is a configuration mistake.
const MIN_SECRET_LENGTH = 32;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUIRED = ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_JWT_SECRET"] as const;

type Env = Record<string, string | undefined>;

/** null: nothing configured. Throws when half configured. */
export function tenantAuthFromEnv(env: Env = process.env): TenantAuth | null {
  const value = (name: string) => env[name]?.trim() || undefined;
  const present = REQUIRED.filter((name) => value(name));
  if (present.length === 0) return null;
  if (present.length < REQUIRED.length) {
    const missing = REQUIRED.filter((name) => !value(name));
    throw new Error(
      `Tenant database access is half configured: ${present.join(", ")} set but ${missing.join(", ")} missing. ` +
        "Set both, or remove both to run on local mock data."
    );
  }
  const secret = value("SUPABASE_JWT_SECRET")!;
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SUPABASE_JWT_SECRET is ${secret.length} characters; it must be at least ${MIN_SECRET_LENGTH}.`);
  }
  const pinned = value("VENUE_TENANT_ID");
  if (pinned && !UUID_RE.test(pinned)) {
    throw new Error("VENUE_TENANT_ID must be the venue's tenant id, a UUID from the tenants table.");
  }
  // Supabase's dashboard shows key ids in upper case but only matches them in
  // lower case: an upper-case kid is refused with "No suitable key was found to
  // decode the JWT". Found rehearsing on staging.
  return { apikey: value("SUPABASE_PUBLISHABLE_KEY")!, secret, pinnedTenantId: pinned, kid: value("SUPABASE_JWT_KID")?.toLowerCase() };
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");

function sign(auth: TenantAuth, claims: Record<string, unknown>, nowSeconds: number): string {
  const header = { alg: "HS256", typ: "JWT", ...(auth.kid ? { kid: auth.kid } : {}) };
  const payload = { role: "tenant_app", ...claims, iat: nowSeconds, exp: nowSeconds + TOKEN_TTL_SECONDS };
  const signed = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", auth.secret).update(signed).digest("base64url");
  return `${signed}.${signature}`;
}

/** A token for one business's rows. */
export function signTenantToken(auth: TenantAuth, tenantId: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (!UUID_RE.test(tenantId)) throw new Error("A tenant token needs a tenant id.");
  return sign(auth, { tenant_id: tenantId }, nowSeconds);
}

/** A token that names no business: it can call the lookups and read nothing else. */
export function signLookupToken(auth: TenantAuth, nowSeconds = Math.floor(Date.now() / 1000)): string {
  return sign(auth, {}, nowSeconds);
}

// One token per business, reused for most of its minute. Signing is cheap, but a
// page makes a few dozen database calls and there's no reason to sign each.
const cache = new Map<string, { token: string; exp: number }>();

export function tenantToken(auth: TenantAuth, tenantId: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const key = `${tenantId}|${auth.kid ?? ""}|${auth.secret}`;
  const hit = cache.get(key);
  if (hit && hit.exp - nowSeconds > REFRESH_BEFORE_SECONDS) return hit.token;
  const token = signTenantToken(auth, tenantId, nowSeconds);
  cache.set(key, { token, exp: nowSeconds + TOKEN_TTL_SECONDS });
  return token;
}
