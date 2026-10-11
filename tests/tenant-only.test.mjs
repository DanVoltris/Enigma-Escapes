// The app reaches its database as a named business, or not at all.
//
// These read the source rather than loading it: lib/supabase.ts imports
// "./tenant-token" without a file extension, which Next and tsc resolve but
// node's own loader does not. What matters here is the property — no path
// through the app uses the key that skips every policy — and that is exactly
// what a future change would have to break for these to fail. The behaviour
// itself is checked on the deployed site by /api/health, which answers
// {"database":"tenant"} only when a signed token was accepted.
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
