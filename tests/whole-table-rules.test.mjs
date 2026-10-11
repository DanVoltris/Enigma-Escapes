// migrations/0013: the old "unique across the whole table" rules come off, and
// the per-business ones (0003) become the primary keys. What must survive is
// just as important: the rules on values that are unique by nature.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { applyMigration, buildDatabase, read } from "./pg-harness.mjs";

const keyOf = async (db, table) =>
  (await db.query(
    `select coalesce(string_agg(a.attname, ',' order by k.ord), '-') cols
       from pg_constraint c
       join unnest(c.conkey) with ordinality k(attnum, ord) on true
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.conname = $1 and c.contype = 'p'`, [`${table}_pkey`])).rows[0].cols;
const exists = async (db, name) =>
  (await db.query("select count(*)::int n from pg_class where relname = $1", [name])).rows[0].n > 0;

describe("migration 0013: the whole-table rules come off", () => {
  let db;
  before(async () => {
    db = await buildDatabase({ through: "0012" });
    assert.equal(await keyOf(db, "promo_codes"), "code", "setup: expected the old whole-table key first");
    await applyMigration(db, "0013_drop-whole-table-rules.sql");
  });

  test("the natural keys are now the business plus the name", async () => {
    for (const [table, cols] of [
      ["experiences", "tenant_id,id"], ["customers", "tenant_id,email"], ["promo_codes", "tenant_id,code"],
      ["gift_vouchers", "tenant_id,code"], ["reward_codes", "tenant_id,code"], ["taxes", "tenant_id,id"],
      ["location_hours", "tenant_id,location"], ["settings", "tenant_id,key"], ["feedback", "tenant_id,reference"],
      ["booking_email_stats", "tenant_id,key"], ["booking_id_reissues", "tenant_id,old_id"],
    ]) assert.equal(await keyOf(db, table), cols, `${table} primary key`);
  });

  test("the remaining whole-table rules on chosen names are gone", async () => {
    for (const name of ["staff_accounts_email_key", "quotes_number_key", "slot_blocks_unique"])
      assert.equal(await exists(db, name), false, `${name} should have been dropped`);
  });

  test("the rules on values unique by nature survive", async () => {
    for (const name of ["quotes_token_key", "reward_codes_earned_booking_key", "booking_id_reissues_new_id_key"])
      assert.equal(await exists(db, name), true, `${name} must stay unique across every business`);
    const rows = await db.query("select count(*)::int n from pg_class where relname like 'gift_vouchers%session%'");
    assert.ok(rows.rows[0].n >= 1, "the Stripe session rule must stay");
  });

  test("uuid primary keys are untouched", async () => {
    for (const table of ["bookings", "slot_blocks", "quotes", "staff_accounts"])
      assert.equal(await keyOf(db, table), "id", `${table} primary key`);
  });

  test("the scripts' lookups keep an index", async () => {
    assert.ok(await exists(db, "customers_email_idx"));
    assert.ok(await exists(db, "booking_email_stats_key_idx"));
  });

  test("running it again changes nothing", async () => {
    // The migration itself, without the runner's bookkeeping — in real use the
    // runner would never send an applied migration a second time.
    await db.exec("set role service_role");
    await db.query("select public._migrate_exec($1)", [read("migrations/0013_drop-whole-table-rules.sql")]);
    await db.exec("reset role");
    assert.equal(await keyOf(db, "promo_codes"), "tenant_id,code");
    assert.equal(await keyOf(db, "settings"), "tenant_id,key");
  });

  test("two businesses can then hold the same code, and one still cannot hold it twice", async () => {
    const B = (await db.query("insert into tenants (name) values ('Business B') returning id")).rows[0].id;
    const A = (await db.query("select id from tenants order by created_at limit 1")).rows[0].id;
    await db.query("insert into promo_codes (code, percent_off, tenant_id) values ('WELCOME10', 10, $1)", [A]);
    await db.query("insert into promo_codes (code, percent_off, tenant_id) values ('WELCOME10', 20, $1)", [B]);
    assert.equal((await db.query("select count(*)::int n from promo_codes where code = 'WELCOME10'")).rows[0].n, 2);
    await assert.rejects(
      () => db.query("insert into promo_codes (code, percent_off, tenant_id) values ('WELCOME10', 30, $1)", [B]),
      /duplicate key/);
  });
});

describe("migration 0013 can be undone", () => {
  test("with one business, everything goes back", async () => {
    const db = await buildDatabase();
    await db.exec(read("migrations/rollback/0013_drop-whole-table-rules.down.sql"));
    assert.equal(await keyOf(db, "promo_codes"), "code");
    assert.equal(await keyOf(db, "settings"), "key");
    assert.ok(await exists(db, "staff_accounts_email_key"));
    assert.ok(await exists(db, "promo_codes_tenant_code_key"), "the per-business index should be back as a plain index");
    assert.equal(await exists(db, "customers_email_idx"), false);
  });

  test("with two businesses it refuses, rather than failing half way", async () => {
    const db = await buildDatabase();
    await db.query("insert into tenants (name) values ('Business B')");
    await assert.rejects(() => db.exec(read("migrations/rollback/0013_drop-whole-table-rules.down.sql")),
      /holds 2 businesses/);
    // And it leaves no half-open transaction: the next query just works.
    assert.equal(await keyOf(db, "promo_codes"), "tenant_id,code", "nothing should have changed");
    assert.ok(await exists(db, "customers_email_idx"), "the rollback should not have part-run");
  });
});
