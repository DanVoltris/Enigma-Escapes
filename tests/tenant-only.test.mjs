// The app reaches its database as a named business, or not at all.
//
// Run with --import ./tests/resolve-ts.mjs, which lets node follow the
// extensionless imports the app writes. Both halves matter: what the client
// does when a venue's settings are missing, and that no other path through the
// app reaches for the key that skips every policy.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (f) => readFileSync(join(root, f), "utf8");
const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
});

describe("the service_role key stays out of the app", () => {
  test("only lib/storage.ts reads it (Supabase Storage has its own rules, not these policies)", () => {
    const users = [...walk(join(root, "lib")), ...walk(join(root, "app"))]
      .filter((f) => readFileSync(f, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"))
      .map((f) => f.slice(root.length));
    assert.deepEqual(users, ["lib/storage.ts"], `unexpected service_role key use: ${users.join(", ")}`);
  });

  test("the database client has no fallback left in it", () => {
    const src = read("lib/supabase.ts");
    assert.ok(!/SERVICE_KEY/.test(src), "lib/supabase.ts still refers to a service key");
    assert.match(src, /database access is not configured/, "the refusal message is gone");
    assert.match(src, /apikey: tenant\.apikey/, "requests no longer carry the business's own key");
  });

  test("a venue without its settings fails rather than falling back", () => {
    const src = read("lib/supabase.ts");
    // The one place a request is built: it is reached only past the refusal.
    const refusal = src.indexOf("database access is not configured");
    const request = src.indexOf("return fetch(");
    assert.ok(refusal > -1 && request > refusal, "the request is built before the settings are checked");
  });

  test("tenant mode is the only database mode the app reports", () => {
    assert.match(read("lib/supabase.ts"), /databaseMode\(\): "local" \| "tenant"/);
  });
});

describe("a venue reaches its database as a business, or not at all", () => {
  const TENANT_ENV = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_JWT_SECRET: "x".repeat(40),
    VENUE_TENANT_ID: "3b8a1f6e-2c4d-4e9a-9f10-7d2c5b8e1a44",
  };
  let n = 0;
  // Fresh each time: the client reads its settings once, at import.
  const load = async (env) => {
    for (const k of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_JWT_SECRET", "VENUE_TENANT_ID", "SUPABASE_SERVICE_ROLE_KEY", "USE_LOCAL_DATA"]) delete process.env[k];
    Object.assign(process.env, env);
    return import(`../lib/supabase.ts?case=${n++}`);
  };

  test("with its settings, it is in tenant mode", async () => {
    assert.equal((await load(TENANT_ENV)).databaseMode(), "tenant");
  });

  test("with ONLY the service_role key, it refuses rather than running unprotected", async () => {
    const { rest } = await load({ SUPABASE_URL: TENANT_ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: "service-role-key" });
    await assert.rejects(() => rest("bookings?select=id"), /database access is not configured/);
  });

  test("half configured refuses, naming what is missing", async () => {
    const { rest } = await load({ SUPABASE_URL: TENANT_ENV.SUPABASE_URL, SUPABASE_JWT_SECRET: TENANT_ENV.SUPABASE_JWT_SECRET });
    await assert.rejects(() => rest("bookings?select=id"), /half configured/);
  });

  test("local mock data still runs with no settings at all", async () => {
    assert.equal((await load({ USE_LOCAL_DATA: "true" })).databaseMode(), "local");
  });
});
