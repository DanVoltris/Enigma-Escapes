// How a request's business is worked out (lib/tenant-resolve.ts), against a
// stand-in for Supabase's API: what gets asked, with which token, and what is
// remembered.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { forgetHosts, normalizeHost, tenantResolver, TENANT_HEADER } from "../lib/tenant-resolve.ts";

const A = "3b8a1f6e-2c4d-4e9a-9f10-7d2c5b8e1a44";
const auth = { apikey: "sb_publishable_test", secret: "s".repeat(40) };
const decode = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

// Records every call and answers from a table of {function: {argument: tenant}}.
function fakeApi(answers) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const fn = url.split("/rpc/")[1];
    const args = JSON.parse(init.body);
    calls.push({ fn, args, auth: init.headers.Authorization.replace("Bearer ", ""), apikey: init.headers.apikey });
    const value = answers[fn]?.[Object.values(args)[0]] ?? null;
    return { ok: true, json: async () => value };
  };
  return { calls, fetchFn };
}

describe("the address", () => {
  beforeEach(forgetHosts);
  test("is lower-cased and loses its port before it is looked up", () => {
    assert.equal(normalizeHost(" Enigma.VoltrisBooking.com:443 "), "enigma.voltrisbooking.com");
    assert.equal(normalizeHost(null), "");
  });
  test("names its business", async () => {
    const api = fakeApi({ tenant_for_host: { "enigma.voltrisbooking.com": A } });
    const r = tenantResolver("https://x.supabase.co", auth, { fetchFn: api.fetchFn });
    assert.equal(await r.forHost("Enigma.voltrisbooking.com"), A);
    assert.equal(api.calls[0].fn, "tenant_for_host");
    assert.deepEqual(api.calls[0].args, { p_host: "enigma.voltrisbooking.com" });
  });
  test("an unknown address names nothing", async () => {
    const api = fakeApi({});
    const r = tenantResolver("https://x.supabase.co", auth, { fetchFn: api.fetchFn });
    assert.equal(await r.forHost("nobody.voltrisbooking.com"), null);
  });
  test("an answer is remembered for a few minutes, then asked again", async () => {
    let clock = 1_000_000;
    const api = fakeApi({ tenant_for_host: { "a.test": A } });
    const r = tenantResolver("https://x.supabase.co", auth, { fetchFn: api.fetchFn, now: () => clock });
    await r.forHost("a.test"); await r.forHost("a.test"); await r.forHost("A.test:8443");
    assert.equal(api.calls.length, 1, "three requests, one lookup");
    clock += 301_000;
    await r.forHost("a.test");
    assert.equal(api.calls.length, 2, "asked again once the answer aged out");
  });
  test("'no such address' is remembered too, so a bad address can't hammer the database", async () => {
    const api = fakeApi({});
    const r = tenantResolver("https://x.supabase.co", auth, { fetchFn: api.fetchFn });
    await r.forHost("nobody.test"); await r.forHost("nobody.test");
    assert.equal(api.calls.length, 1);
  });
});

describe("the lookup token", () => {
  beforeEach(forgetHosts);
  test("names the app's role and no business, and carries the publishable key", async () => {
    const api = fakeApi({ tenant_for_host: { "a.test": A } });
    await tenantResolver("https://x.supabase.co", auth, { fetchFn: api.fetchFn }).forHost("a.test");
    const claims = decode(api.calls[0].auth);
    assert.equal(claims.role, "tenant_app");
    assert.equal(claims.tenant_id, undefined, "a lookup must not name a business");
    assert.equal(api.calls[0].apikey, "sb_publishable_test");
  });
  test("a malformed answer is treated as no business", async () => {
    const api = fakeApi({ tenant_for_host: { "a.test": "not-a-uuid" } });
    assert.equal(await tenantResolver("https://x.supabase.co", auth, { fetchFn: api.fetchFn }).forHost("a.test"), null);
  });
});

describe("the staff session and sign-in", () => {
  test("a session is looked up by the hash of its cookie, never the cookie itself", async () => {
    const api = fakeApi({ tenant_for_session: { [createHash("sha256").update("cookie-token").digest("hex")]: A } });
    const r = tenantResolver("https://x.supabase.co", auth, { fetchFn: api.fetchFn });
    assert.equal(await r.forSession("cookie-token"), A);
    assert.notEqual(Object.values(api.calls[0].args)[0], "cookie-token");
    assert.equal(await r.forSession(""), null);
  });
  test("a sign-in email names its business; blank or absurd input asks nothing", async () => {
    const api = fakeApi({ tenant_for_staff_email: { "owner@example.invalid": A } });
    const r = tenantResolver("https://x.supabase.co", auth, { fetchFn: api.fetchFn });
    assert.equal(await r.forStaffEmail("  owner@example.invalid "), A);
    assert.equal(await r.forStaffEmail(""), null);
    assert.equal(await r.forStaffEmail("x".repeat(300)), null);
    assert.equal(api.calls.length, 1);
  });
});

test("the header proxy.ts stamps and lib/supabase.ts reads is one name", () => {
  assert.equal(TENANT_HEADER, "x-tenant-id");
});
