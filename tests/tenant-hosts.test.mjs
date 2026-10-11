// migrations/0014: the lookups that find a request's business before any of
// its data is read, on real Postgres. They run as tenant_app with a token that
// names no business, and must answer with a tenant id and nothing else.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { applyMigration, asTenant, buildDatabase, claimsFor, read } from "./pg-harness.mjs";

const NOBODY = JSON.stringify({ role: "tenant_app" }); // the lookup token's claims

describe("finding a request's business", () => {
  let db, A, B;
  before(async () => {
    db = await buildDatabase();
    A = (await db.query("select id from tenants order by created_at limit 1")).rows[0].id;
    B = (await db.query("insert into tenants (name, slug) values ('Business B', 'business-b') returning id")).rows[0].id;
    await db.query("insert into tenant_hosts (host, tenant_id) values ('a.voltrisbooking.com', $1), ('www.business-a.example', $1)", [A]);
    await db.query("insert into tenant_hosts (host, tenant_id) values ('business-b.voltrisbooking.com', $1)", [B]);
    await db.query("insert into staff_accounts (email, name, password_hash, tenant_id) values ('owner@a.example', 'A owner', 'x', $1), ('shared@both.example', 'A', 'x', $1)", [A]);
    await db.query("insert into staff_accounts (email, name, password_hash, tenant_id) values ('shared@both.example', 'B', 'x', $1), ('gone@b.example', 'Left', 'x', $1)", [B]);
    await db.query("update staff_accounts set active = false where email = 'gone@b.example'");
    const staffA = (await db.query("select id from staff_accounts where email = 'owner@a.example'")).rows[0].id;
    await db.query("insert into staff_sessions (token_hash, staff_id, expires_at, tenant_id) values ($1, $2, now() + interval '1 day', $3), ($4, $2, now() - interval '1 minute', $3)",
      [createHash("sha256").update("live-cookie").digest("hex"), staffA, A, createHash("sha256").update("stale-cookie").digest("hex")]);
  });

  const lookup = (fn, arg) => asTenant(db, NOBODY, async (tx) => (await tx.query(`select public.${fn}($1) as id`, [arg])).rows[0].id);

  test("by web address, however it is written", async () => {
    assert.equal(await lookup("tenant_for_host", "a.voltrisbooking.com"), A);
    assert.equal(await lookup("tenant_for_host", "A.VoltrisBooking.com:443"), A, "case and port must not matter");
    assert.equal(await lookup("tenant_for_host", "www.business-a.example"), A, "a business's own domain");
    assert.equal(await lookup("tenant_for_host", "business-b.voltrisbooking.com"), B);
    assert.equal(await lookup("tenant_for_host", "nobody.voltrisbooking.com"), null);
    assert.equal(await lookup("tenant_for_host", ""), null);
  });

  test("by staff session, while it lasts", async () => {
    assert.equal(await lookup("tenant_for_session", createHash("sha256").update("live-cookie").digest("hex")), A);
    assert.equal(await lookup("tenant_for_session", createHash("sha256").update("stale-cookie").digest("hex")), null, "an expired session names nothing");
    assert.equal(await lookup("tenant_for_session", "nonsense"), null);
  });

  test("by sign-in email — only when exactly one active account has it", async () => {
    assert.equal(await lookup("tenant_for_staff_email", "Owner@A.example "), A, "case and spaces must not matter");
    assert.equal(await lookup("tenant_for_staff_email", "shared@both.example"), null, "an email at two businesses must not pick one");
    assert.equal(await lookup("tenant_for_staff_email", "gone@b.example"), null, "a deactivated account names nothing");
    assert.equal(await lookup("tenant_for_staff_email", "nobody@nowhere.example"), null);
  });

  test("a token that names no business can call the lookups and read nothing else", async () => {
    const seen = await asTenant(db, NOBODY, async (tx) => ({
      hosts: (await tx.query("select count(*)::int n from tenant_hosts")).rows[0].n,
      tenants: (await tx.query("select count(*)::int n from tenants")).rows[0].n,
      staff: (await tx.query("select count(*)::int n from staff_accounts")).rows[0].n,
    }));
    assert.deepEqual(seen, { hosts: 0, tenants: 0, staff: 0 });
  });

  test("the public roles cannot call them at all", async () => {
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(
        () => asTenant(db, undefined, (tx) => tx.query("select public.tenant_for_host('a.voltrisbooking.com')"), { role }),
        /permission denied/, `${role} should be refused`);
    }
  });

  test("a business sees and manages only its own addresses", async () => {
    const hostsA = await asTenant(db, claimsFor(A), async (tx) => (await tx.query("select host from tenant_hosts order by host")).rows.map((r) => r.host));
    assert.deepEqual(hostsA, ["a.voltrisbooking.com", "www.business-a.example"]);
    await asTenant(db, claimsFor(B), async (tx) => {
      await tx.query("insert into tenant_hosts (host) values ('shop.business-b.example')"); // tenant_id filled in
      assert.equal((await tx.query("select tenant_id from tenant_hosts where host = 'shop.business-b.example'")).rows[0].tenant_id, B);
      await assert.rejects(() => tx.query("insert into tenant_hosts (host, tenant_id) values ('steal.example', $1)", [A]), /row-level security/);
    });
  });

  test("a slug has to look like a hostname label", async () => {
    await assert.rejects(() => db.query("update tenants set slug = 'Not A Slug!' where id = $1", [B]), /tenants_slug_format/);
    await db.query("update tenants set slug = 'b-2' where id = $1", [B]);
  });

  test("running the migration again changes nothing", async () => {
    const before = (await db.query("select count(*)::int n from tenant_hosts")).rows[0].n;
    await db.exec("set role service_role");
    await db.query("select public._migrate_exec($1)", [read("migrations/0014_tenant-hosts.sql")]);
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int n from tenant_hosts")).rows[0].n, before);
    assert.equal((await db.query("select count(*)::int n from pg_policies where tablename = 'tenant_hosts'")).rows[0].n, 1, "one policy, not two");
  });

  test("and can be undone", async () => {
    const fresh = await buildDatabase();
    await fresh.exec(read("migrations/rollback/0014_tenant-hosts.down.sql"));
    assert.equal((await fresh.query("select to_regclass('public.tenant_hosts') t")).rows[0].t, null);
    assert.equal((await fresh.query("select to_regprocedure('public.tenant_for_host(text)') f")).rows[0].f, null);
    assert.equal((await fresh.query("select count(*)::int n from schema_migrations where version = '0014'")).rows[0].n, 0);
  });
});
