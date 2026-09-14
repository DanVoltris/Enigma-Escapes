// The token a request carries to name its business (lib/tenant-token.ts).
// Pure unit checks; tests/tenant-isolation.test.mjs checks the database side.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signTenantToken, tenantAuthFromEnv, tenantToken, TOKEN_TTL_SECONDS } from "../lib/tenant-token.ts";

const SECRET = "x".repeat(40);
const TENANT = "3b8a1f6e-2c4d-4e9a-9f10-7d2c5b8e1a44";
const FULL = { SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_JWT_SECRET: SECRET, VENUE_TENANT_ID: TENANT };
const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString());

describe("reading a venue's settings", () => {
  test("none set: service mode (null)", () => {
    assert.equal(tenantAuthFromEnv({}), null);
    assert.equal(tenantAuthFromEnv({ SUPABASE_JWT_SECRET: "   " }), null, "blank counts as unset");
  });
  test("all set: tenant mode", () => {
    assert.deepEqual(tenantAuthFromEnv(FULL), { apikey: "sb_publishable_test", secret: SECRET, tenantId: TENANT, kid: undefined });
  });
  test("half set refuses, naming what is missing — never falls back to service_role", () => {
    assert.throws(() => tenantAuthFromEnv({ SUPABASE_JWT_SECRET: SECRET }), /half configured.*SUPABASE_PUBLISHABLE_KEY, VENUE_TENANT_ID missing/);
    assert.throws(() => tenantAuthFromEnv({ ...FULL, VENUE_TENANT_ID: "" }), /VENUE_TENANT_ID missing/);
  });
  test("a short secret or a malformed tenant id refuses", () => {
    assert.throws(() => tenantAuthFromEnv({ ...FULL, SUPABASE_JWT_SECRET: "short" }), /at least 32/);
    assert.throws(() => tenantAuthFromEnv({ ...FULL, VENUE_TENANT_ID: "enigma" }), /must be the venue's tenant id/);
  });
  test("an optional key id is carried", () => {
    assert.equal(tenantAuthFromEnv({ ...FULL, SUPABASE_JWT_KID: "key-1" }).kid, "key-1");
  });
});

describe("the signed token", () => {
  const auth = tenantAuthFromEnv(FULL);
  test("is a valid HS256 JWT signed with the secret", () => {
    const token = signTenantToken(auth, 1_000_000);
    const [h, p, sig] = token.split(".");
    assert.equal(sig, createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url"));
    assert.deepEqual(decode(h), { alg: "HS256", typ: "JWT" });
  });
  test("names the tenant_app role and the business, and lasts a minute", () => {
    const payload = decode(signTenantToken(auth, 1_000_000).split(".")[1]);
    assert.deepEqual(payload, { role: "tenant_app", tenant_id: TENANT, iat: 1_000_000, exp: 1_000_000 + TOKEN_TTL_SECONDS });
    assert.equal(TOKEN_TTL_SECONDS, 60);
  });
  test("a different secret gives a signature that doesn't verify", () => {
    const token = signTenantToken({ ...auth, secret: "y".repeat(40) }, 1_000_000);
    const [h, p, sig] = token.split(".");
    assert.notEqual(sig, createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url"));
  });
  test("carries kid in the header when set", () => {
    assert.equal(decode(signTenantToken({ ...auth, kid: "key-1" }, 1).split(".")[0]).kid, "key-1");
  });
  test("is reused for most of its minute, then re-signed", () => {
    const a = tenantToken(auth, 2_000_000);
    assert.equal(tenantToken(auth, 2_000_000 + 30), a, "re-signed too early");
    const b = tenantToken(auth, 2_000_000 + 45);
    assert.notEqual(b, a, "kept a token about to expire");
    assert.ok(decode(b.split(".")[1]).exp - (2_000_000 + 45) === TOKEN_TTL_SECONDS);
  });
});
