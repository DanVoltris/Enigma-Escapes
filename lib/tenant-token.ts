import { createHmac } from "crypto";

// How a request tells the database which business it is for.
//
// Row level security (migrations/0004) keeps the tenant_app role to the rows of
// one business, named by the verified JWT the request carries. This signs that
// JWT: { role: "tenant_app", tenant_id }, HS256, a minute long, with a shared
// secret imported into the venue's Supabase project as a JWT signing key. The
// Data API verifies it, switches to tenant_app, and hands the claims to Postgres
// for that request only.
//
// A venue runs this way when all three of its settings are present:
//   SUPABASE_PUBLISHABLE_KEY  the project's publishable key (sent as apikey)
//   SUPABASE_JWT_SECRET       the shared secret imported as a signing key
//   VENUE_TENANT_ID           this venue's row in the tenants table
// With none of them it runs as before, on the service_role key. With only some,
// it refuses to run: a half-configured venue must be loud, never quietly fall
// back to the key that skips every policy.
//
// Pure module (only node's crypto) so tests can load it without Next.

export type TenantAuth = {
  apikey: string;
  secret: string;
  tenantId: string;
  kid?: string; // SUPABASE_JWT_KID, if the project needs the signing key named in the header
};

export const TOKEN_TTL_SECONDS = 60;
// A token is reused until this close to expiry, then re-signed.
const REFRESH_BEFORE_SECONDS = 20;
// HS256 is only as strong as its secret; anything shorter is a configuration mistake.
const MIN_SECRET_LENGTH = 32;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTINGS = ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_JWT_SECRET", "VENUE_TENANT_ID"] as const;

type Env = Record<string, string | undefined>;

/** null: not configured, use the service_role key. Throws when half configured. */
export function tenantAuthFromEnv(env: Env = process.env): TenantAuth | null {
  const value = (name: string) => env[name]?.trim() || undefined;
  const present = SETTINGS.filter((name) => value(name));
  if (present.length === 0) return null;
  if (present.length < SETTINGS.length) {
    const missing = SETTINGS.filter((name) => !value(name));
    throw new Error(
      `Tenant database access is half configured: ${present.join(", ")} set but ${missing.join(", ")} missing. ` +
        "Set all three, or remove all three to use the service_role key."
    );
  }
  const secret = value("SUPABASE_JWT_SECRET")!;
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SUPABASE_JWT_SECRET is ${secret.length} characters; it must be at least ${MIN_SECRET_LENGTH}.`);
  }
  const tenantId = value("VENUE_TENANT_ID")!;
  if (!UUID_RE.test(tenantId)) {
    throw new Error("VENUE_TENANT_ID must be the venue's tenant id, a UUID from the tenants table.");
  }
  // Supabase's dashboard shows key ids in upper case but only matches them in
  // lower case: an upper-case kid is refused with "No suitable key was found to
  // decode the JWT". Found rehearsing on staging.
  return { apikey: value("SUPABASE_PUBLISHABLE_KEY")!, secret, tenantId, kid: value("SUPABASE_JWT_KID")?.toLowerCase() };
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");

export function signTenantToken(auth: TenantAuth, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = { alg: "HS256", typ: "JWT", ...(auth.kid ? { kid: auth.kid } : {}) };
  const payload = { role: "tenant_app", tenant_id: auth.tenantId, iat: nowSeconds, exp: nowSeconds + TOKEN_TTL_SECONDS };
  const signed = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", auth.secret).update(signed).digest("base64url");
  return `${signed}.${signature}`;
}

// One token per business, reused for most of its minute. Signing is cheap, but a
// page makes a few dozen database calls and there's no reason to sign each.
const cache = new Map<string, { token: string; exp: number }>();

export function tenantToken(auth: TenantAuth, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const key = `${auth.tenantId}|${auth.kid ?? ""}|${auth.secret}`;
  const hit = cache.get(key);
  if (hit && hit.exp - nowSeconds > REFRESH_BEFORE_SECONDS) return hit.token;
  const token = signTenantToken(auth, nowSeconds);
  cache.set(key, { token, exp: nowSeconds + TOKEN_TTL_SECONDS });
  return token;
}
