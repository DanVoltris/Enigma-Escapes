// The token a request carries to name its business (lib/tenant-token.ts).
// Pure unit checks; tests/tenant-isolation.test.mjs checks the database side.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signLookupToken, signTenantToken, tenantAuthFromEnv, tenantToken, TOKEN_TTL_SECONDS } from "../lib/tenant-token.ts";

const SECRET = "x".repeat(40);
const TENANT = "3b8a1f6e-2c4d-4e9a-9f10-7d2c5b8e1a44";
const BOTH = { SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_JWT_SECRET: SECRET };
const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString());

describe("reading a venue's settings", () => {
  test("none set: nothing configured (null)", () => {
    assert.equal(tenantAuthFromEnv({}), null);
    assert.equal(tenantAuthFromEnv({ SUPABASE_JWT_SECRET: "   " }), null, "blank counts as unset");
  });
  test("key and secret: configured, serving whichever business each request names", () => {
    assert.deepEqual(tenantAuthFromEnv(BOTH), { apikey: "sb_publishable_test", secret: SECRET, pinnedTenantId: undefined, kid: undefined });
  });
  test("with VENUE_TENANT_ID as well: pinned to one business", () => {
    assert.equal(tenantAuthFromEnv({ ...BOTH, VENUE_TENANT_ID: TENANT }).pinnedTenantId, TENANT);
  });
  test("half set refuses, naming what is missing", () => {
    assert.throws(() => tenantAuthFromEnv({ SUPABASE_JWT_SECRET: SECRET }), /half configured.*SUPABASE_PUBLISHABLE_KEY missing/);
    assert.throws(() => tenantAuthFromEnv({ SUPABASE_PUBLISHABLE_KEY: "k" }), /SUPABASE_JWT_SECRET missing/);
  });
  test("a short secret or a malformed pin refuses", () => {
    assert.throws(() => tenantAuthFromEnv({ ...BOTH, SUPABASE_JWT_SECRET: "short" }), /at least 32/);
    assert.throws(() => tenantAuthFromEnv({ ...BOTH, VENUE_TENANT_ID: "enigma" }), /must be the venue's tenant id/);
  });
  test("an optional key id is carried, lower-cased as Supabase matches it", () => {
    assert.equal(tenantAuthFromEnv({ ...BOTH, SUPABASE_JWT_KID: "key-1" }).kid, "key-1");
    assert.equal(tenantAuthFromEnv({ ...BOTH, SUPABASE_JWT_KID: "FFA4F791-ABCD-4EF0-9A1B-0123456789AB" }).kid, "ffa4f791-abcd-4ef0-9a1b-0123456789ab");
  });
});

describe("the signed token", () => {
  const auth = tenantAuthFromEnv(BOTH);
  test("is a valid HS256 JWT signed with the secret", () => {
    const token = signTenantToken(auth, TENANT, 1_000_000);
    const [h, p, sig] = token.split(".");
    assert.equal(sig, createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url"));
    assert.deepEqual(decode(h), { alg: "HS256", typ: "JWT" });
  });
  test("names the tenant_app role and the business, and lasts a minute", () => {
    const payload = decode(signTenantToken(auth, TENANT, 1_000_000).split(".")[1]);
    assert.deepEqual(payload, { role: "tenant_app", tenant_id: TENANT, iat: 1_000_000, exp: 1_000_000 + TOKEN_TTL_SECONDS });
    assert.equal(TOKEN_TTL_SECONDS, 60);
  });
  test("refuses to name something that is not a business id", () => {
    assert.throws(() => signTenantToken(auth, "enigma"), /needs a tenant id/);
  });
  test("a lookup token names the role and NO business", () => {
    const payload = decode(signLookupToken(auth, 1_000_000).split(".")[1]);
    assert.deepEqual(payload, { role: "tenant_app", iat: 1_000_000, exp: 1_000_000 + TOKEN_TTL_SECONDS });
  });
  test("a different secret gives a signature that doesn't verify", () => {
    const token = signTenantToken({ ...auth, secret: "y".repeat(40) }, TENANT, 1_000_000);
    const [h, p, sig] = token.split(".");
    assert.notEqual(sig, createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url"));
  });
  test("carries kid in the header when set", () => {
    assert.equal(decode(signTenantToken({ ...auth, kid: "key-1" }, TENANT, 1).split(".")[0]).kid, "key-1");
  });
  test("is reused for most of its minute, then re-signed — per business", () => {
    const a = tenantToken(auth, TENANT, 2_000_000);
    assert.equal(tenantToken(auth, TENANT, 2_000_000 + 30), a, "re-signed too early");
    const b = tenantToken(auth, TENANT, 2_000_000 + 45);
    assert.notEqual(b, a, "kept a token about to expire");
    assert.ok(decode(b.split(".")[1]).exp - (2_000_000 + 45) === TOKEN_TTL_SECONDS);
    const other = "9b8a1f6e-2c4d-4e9a-9f10-7d2c5b8e1a44";
    assert.equal(decode(tenantToken(auth, other, 2_000_000 + 45).split(".")[1]).tenant_id, other, "another business gets its own token");
  });
});
