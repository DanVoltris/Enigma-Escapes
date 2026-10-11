// A business creating itself: the form's rules (lib/signup-rules.ts, lib/signup.ts)
// and the database side (migrations/0015) on real Postgres.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { asTenant, buildDatabase, claimsFor, read } from "./pg-harness.mjs";
import { slugFromName, slugProblem } from "../lib/signup-rules.ts";
import { signupAllowed, signupOffered, signupProblem } from "../lib/signup.ts";

const NOBODY = JSON.stringify({ role: "tenant_app" });
const PERMS = JSON.stringify(["calendar", "settings", "staff"]);

describe("the address a business chooses", () => {
  test("is suggested from its name", () => {
    assert.equal(slugFromName("Enigma Escapes!"), "enigma-escapes");
    assert.equal(slugFromName("  Café Évasion — Montréal  "), "cafe-evasion-montreal");
    assert.equal(slugFromName("x".repeat(80)), "x".repeat(63));
  });
  test("has to look like a hostname label, and not be one the platform needs", () => {
    assert.equal(slugProblem("enigma-escapes"), null);
    assert.match(slugProblem(""), /Choose a web address/);
    assert.match(slugProblem("ab"), /at least 3/);
    assert.match(slugProblem("-bad-"), /not starting or ending/);
    assert.match(slugProblem("Has Space"), /lower-case/);
    assert.match(slugProblem("www"), /reserved/);
    assert.match(slugProblem("api"), /reserved/);
  });
});

describe("the form", () => {
  const good = { name: "Puzzle Palace", slug: "puzzle-palace", ownerName: "Sam", email: "sam@example.com", password: "correct horse", timezone: "America/Toronto" };
  test("accepts a complete, sensible sign-up", () => assert.equal(signupProblem(good), null));
  test("names the first thing wrong, in plain words", () => {
    assert.match(signupProblem({ ...good, name: " " }), /business name/);
    assert.match(signupProblem({ ...good, slug: "www" }), /reserved/);
    assert.match(signupProblem({ ...good, ownerName: "" }), /your name/);
    assert.match(signupProblem({ ...good, email: "sam" }), /email address/);
    assert.match(signupProblem({ ...good, password: "abc" }), /5 characters/);
    assert.match(signupProblem({ ...good, timezone: "Mars/Olympus" }), /timezone/);
    assert.match(signupProblem({ ...good, timezone: "" }), /timezone/);
  });
  test("sign-up exists on the platform deployment only, never on a venue's own site", () => {
    const platform = { SUPABASE_PUBLISHABLE_KEY: "k", SUPABASE_JWT_SECRET: "s".repeat(40) };
    assert.equal(signupOffered(platform), true);
    assert.equal(signupOffered({ ...platform, VENUE_TENANT_ID: "3b8a1f6e-2c4d-4e9a-9f10-7d2c5b8e1a44" }), false, "pinned = a venue's site");
    assert.equal(signupOffered({}), false, "unconfigured");
  });
  test("a connection gets a handful of sign-ups an hour, then has to wait", () => {
    let t = 0;
    for (let i = 0; i < 5; i++) assert.ok(signupAllowed("203.0.113.9", t++), `sign-up ${i + 1}`);
    assert.equal(signupAllowed("203.0.113.9", t++), false, "the sixth is refused");
    assert.ok(signupAllowed("203.0.113.10", t++), "another connection is unaffected");
    assert.ok(signupAllowed("203.0.113.9", t + 61 * 60 * 1000), "an hour later it is allowed again");
  });
});

describe("creating the business (migration 0015)", () => {
  let db, A;
  before(async () => {
    db = await buildDatabase();
    A = (await db.query("select id from tenants order by created_at limit 1")).rows[0].id;
  });
  const create = (args) =>
    asTenant(db, NOBODY, async (tx) => (await tx.query(
      "select public.create_tenant($1, $2, $3, $4, $5, $6, $7::jsonb, $8) as id",
      [args.name ?? "Puzzle Palace", args.slug ?? "puzzle-palace", args.host ?? `${args.slug ?? "puzzle-palace"}.voltrisbooking.com`,
       args.owner ?? "Sam Owner", args.email ?? "sam@example.com", args.hash ?? "salt:hash", args.perms ?? PERMS, args.tz ?? "America/Toronto"]
    )).rows[0].id, { keep: true });

  test("one call makes the business, its address, its owner, its settings and an example room", async () => {
    const id = await create({});
    const [t] = (await db.query("select name, slug from tenants where id = $1", [id])).rows;
    assert.deepEqual(t, { name: "Puzzle Palace", slug: "puzzle-palace" });
    assert.deepEqual((await db.query("select host from tenant_hosts where tenant_id = $1", [id])).rows.map((r) => r.host), ["puzzle-palace.voltrisbooking.com"]);
    const [owner] = (await db.query("select email, name, role, active, permissions, password_hash from staff_accounts where tenant_id = $1", [id])).rows;
    assert.equal(owner.email, "sam@example.com");
    assert.equal(owner.role, "admin");
    assert.equal(owner.active, true);
    assert.deepEqual(owner.permissions, JSON.parse(PERMS));
    assert.equal(owner.password_hash, "salt:hash", "stored exactly as given — the function never sees a password");
    const keys = (await db.query("select key from settings where tenant_id = $1 order by key", [id])).rows.map((r) => r.key);
    assert.deepEqual(keys, ["business_details", "dashboard", "locale", "pricing_mode"]);
    const [loc] = (await db.query("select value from settings where tenant_id = $1 and key = 'locale'", [id])).rows;
    assert.equal(loc.value.timezone, "America/Toronto");
    const [room] = (await db.query("select id, active, price_cents from experiences where tenant_id = $1", [id])).rows;
    assert.deepEqual(room, { id: "your-first-room", active: false, price_cents: 0 }, "an example room, not for sale");
    assert.equal((await db.query("select count(*)::int n from activity_log where tenant_id = $1", [id])).rows[0].n, 1);
  });

  test("the new business is isolated like any other: it sees its rows, business A sees none of them", async () => {
    const id = (await db.query("select id from tenants where slug = 'puzzle-palace'")).rows[0].id;
    const mine = await asTenant(db, claimsFor(id), async (tx) => (await tx.query("select count(*)::int n from staff_accounts")).rows[0].n);
    const theirs = await asTenant(db, claimsFor(A), async (tx) => (await tx.query("select count(*)::int n from staff_accounts where tenant_id = $1", [id])).rows[0].n);
    assert.equal(mine, 1);
    assert.equal(theirs, 0);
  });

  test("a taken address is refused and nothing is half-created", async () => {
    const before = (await db.query("select (select count(*) from tenants) t, (select count(*) from staff_accounts) s")).rows[0];
    await assert.rejects(() => create({ email: "other@example.com" }), /slug_taken/);
    await assert.rejects(() => create({ slug: "another", host: "puzzle-palace.voltrisbooking.com" }), /host_taken/);
    const after = (await db.query("select (select count(*) from tenants) t, (select count(*) from staff_accounts) s")).rows[0];
    assert.deepEqual(after, before);
  });

  test("it re-checks what the app validated", async () => {
    await assert.rejects(() => create({ slug: "Bad Slug", host: "x.voltrisbooking.com" }), /slug_invalid/);
    await assert.rejects(() => create({ name: " ", slug: "blank-name" }), /name_required/);
    await assert.rejects(() => create({ slug: "no-owner", email: "" }), /owner_required/);
    await assert.rejects(() => create({ slug: "no-perms", perms: '"nope"' }), /permissions_required/);
  });

  test("the live address check", async () => {
    const avail = (s) => asTenant(db, NOBODY, async (tx) => (await tx.query("select public.slug_available($1) ok", [s])).rows[0].ok);
    assert.equal(await avail("puzzle-palace"), false);
    assert.equal(await avail("Puzzle-Palace "), false, "case and spaces must not hide a taken address");
    assert.equal(await avail("brand-new"), true);
  });

  test("the public roles cannot create businesses", async () => {
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(
        () => asTenant(db, undefined, (tx) => tx.query("select public.create_tenant('X','x-x','x.test','O','o@x.test','h','[]'::jsonb,'UTC')"), { role }),
        /permission denied/, role);
    }
  });

  test("the migration can be undone, leaving created businesses alone", async () => {
    const fresh = await buildDatabase();
    await asTenant(fresh, NOBODY, (tx) => tx.query("select public.create_tenant('Keep Me','keep-me','keep-me.test','O','o@keep.test','h','[]'::jsonb,'UTC')"), { keep: true });
    await fresh.exec(read("migrations/rollback/0015_signup.down.sql"));
    assert.equal((await fresh.query("select to_regprocedure('public.create_tenant(text,text,text,text,text,text,jsonb,text)') f")).rows[0].f, null);
    assert.equal((await fresh.query("select count(*)::int n from tenants where slug = 'keep-me'")).rows[0].n, 1);
  });
});
