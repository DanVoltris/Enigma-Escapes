// Tenant isolation: one business must never see, change or remove another's
// rows. Runs on every push (.github/workflows/tenant-isolation.yml).
//
//   npm run test:isolation
//
// The database is built the way production's are — scripts/schema.sql, then
// every migration in migrations/ in order, through _migrate_exec as the runner
// sends it — on real PostgreSQL (PGlite) with Supabase's roles. Two businesses
// get rows in every table that carries a tenant_id, then each check runs as the
// app will: role tenant_app, with the business named in request.jwt.claims.
//
// When this fails after you add a table: the table needs a tenant_id column
// (added by a migration, defaulting to current_tenant_id()), and a row template
// in SEED below so the checks can put both businesses' data in it.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { signTenantToken } from "../lib/tenant-token.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ------------------------------------------------------------ the database
async function buildDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  // Supabase's roles and the default grants it gives them on public.
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls; create role authenticator noinherit login;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
  await db.exec(read("scripts/schema.sql"));
  // A business's details exist before 0001 names its tenant from them.
  await db.exec(`insert into settings (key, value) values ('business_details', '{"companyName":"Business A"}')`);
  const files = readdirSync(join(ROOT, "migrations")).filter((f) => /^\d{4}_[a-z0-9-]+\.sql$/.test(f)).sort();
  for (const f of files) {
    const version = f.slice(0, 4);
    const sql = read(`migrations/${f}`).trim().replace(/;?$/, ";") +
      `\ninsert into schema_migrations (version, name, checksum) values ('${version}', '${f}', 'test');`;
    await db.exec("set role service_role");
    try {
      await db.query("select public._migrate_exec($1)", [sql]);
    } finally {
      await db.exec("reset role");
    }
  }
  return db;
}

const tenantTables = async (db) =>
  (await db.query(`
    select c.table_name as t from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and tb.table_type = 'BASE TABLE'
    order by 1`)).rows.map((r) => r.t);

// One row of each table for a business. `k` makes natural keys distinct,
// because the old whole-table unique rules still exist alongside 0003's.
const SEED = {
  experiences: (k) => [`insert into experiences (id, name, tenant_id) values ($1, 'Room ' || $1, $2)`, [`room-${k}`]],
  bookings: (k) => [`insert into bookings (reference, customer, items, pricing, tenant_id) values ($1, jsonb_build_object('email', $1 || '@example.invalid'), jsonb_build_array(jsonb_build_object('date', '2026-10-01', 'quantity', 4, 'location', 'Downtown')), '{"paidCents": 1000}', $2)`, [`VB-${k}`]],
  customers: (k) => [`insert into customers (email, first_name, last_name, tenant_id) values ($1, 'First', 'Last', $2)`, [`cust-${k}@example.invalid`]],
  promo_codes: (k) => [`insert into promo_codes (code, percent_off, tenant_id) values ($1, 10, $2)`, [`PROMO${k}`]],
  gift_vouchers: (k) => [`insert into gift_vouchers (code, face_cents, remaining_cents, active, tenant_id) values ($1, 5000, 2500, true, $2)`, [`GV${k}`]],
  voucher_products: (k) => [`insert into voucher_products (name, amount_cents, tenant_id) values ($1, 5000, $2)`, [`Voucher ${k}`]],
  reward_codes: (k) => [`insert into reward_codes (code, earned_booking, customer_phone, valid_until, tenant_id) values ($1, gen_random_uuid(), '2045550100', now() + interval '30 days', $2)`, [`RW${k}`]],
  booking_requests: (k) => [`insert into booking_requests (room_id, room_name, location, date, time, quantity, first_name, phone, token, tenant_id) values ('r', 'R', 'L', '2026-10-01', '18:00', 4, $1, '2045550100', $1, $2)`, [`req-${k}`]],
  slot_blocks: (k) => [`insert into slot_blocks (room_id, date, time, tenant_id) values ($1, '2030-01-01', '10:00', $2)`, [`room-${k}`]],
  taxes: (k) => [`insert into taxes (id, name, percent, tenant_id) values ($1, 'GST', 5, $2)`, [`tax-${k}`]],
  location_hours: (k) => [`insert into location_hours (location, hours, tenant_id) values ($1, '{}', $2)`, [`Site ${k}`]],
  settings: (k) => [`insert into settings (key, value, tenant_id) values ($1, '{}', $2)`, [`setting_${k}`]],
  staff_accounts: (k) => [`insert into staff_accounts (email, name, password_hash, tenant_id) values ($1, 'Staff', 'x', $2)`, [`staff-${k}@example.invalid`]],
  staff_sessions: (k) => [`insert into staff_sessions (token_hash, staff_id, expires_at, tenant_id) values ($1, (select id from staff_accounts where tenant_id = $2 limit 1), now() + interval '1 day', $2)`, [`hash-${k}`]],
  staff_members: (k) => [`insert into staff_members (id, name, tenant_id) values ($1, 'Member', $2)`, [`member-${k}`]],
  staff_shifts: (k) => [`insert into staff_shifts (member_id, member_name, tenant_id) values ((select id from staff_members where tenant_id = $2 limit 1), $1, $2)`, [`shift-${k}`]],
  staff_notes: (k) => [`insert into staff_notes (note, tenant_id) values ($1, $2)`, [`note ${k}`]],
  activity_log: (k) => [`insert into activity_log (action, tenant_id) values ($1, $2)`, [`action ${k}`]],
  feedback: (k) => [`insert into feedback (reference, rating, tenant_id) values ($1, 5, $2)`, [`FB-${k}`]],
  quotes: (k) => [`insert into quotes (number, token, customer, tenant_id) values ($1, $1 || '-token', '{}', $2)`, [`Q-${k}`]],
  site_events: (k) => [`insert into site_events (kind, tenant_id) values ($1, $2)`, [`view_${k}`]],
  booking_email_stats: (k) => [`insert into booking_email_stats (key, email, name, phone, subscribe, booked_at, bookings, guests, spent, itemised_sessions, itemised_paid, last_booked, tenant_id) values ($1, $1, 'N', 'P', false, now(), 1, 4, 1000, 0, 0, now(), $2)`, [`stats-${k}@example.invalid`]],
  booking_id_reissues: (k) => [`insert into booking_id_reissues (old_id, new_id, reference, tenant_id) values (gen_random_uuid(), gen_random_uuid(), $1, $2)`, [`VB-L${k}`]],
};
// Tables whose rows need another table's row of the same business first.
const ORDER = ["staff_accounts", "staff_members"];

const ROWS = { A: 2, B: 3 }; // different counts, so a leak changes a number

async function seedTwoBusinesses(db) {
  const A = (await db.query("select id from tenants order by created_at limit 1")).rows[0].id;
  const B = (await db.query("insert into tenants (name) values ('Business B') returning id")).rows[0].id;
  // The stats trigger would file every seeded booking under the first tenant
  // (seeding runs outside a tenant_app request); stats rows are seeded directly.
  await db.exec("alter table bookings disable trigger booking_email_stats_trg");
  const tables = await tenantTables(db);
  const ordered = [...ORDER, ...tables.filter((t) => !ORDER.includes(t))];
  for (const [label, id] of [["A", A], ["B", B]]) {
    for (const t of ordered) {
      for (let i = 0; i < ROWS[label]; i++) {
        const [sql, params] = SEED[t](`${label}${i}`);
        await db.query(sql, [...params, id]);
      }
    }
  }
  await db.exec("alter table bookings enable trigger booking_email_stats_trg");
  return { A, B };
}

// Runs `fn` as the app will: role tenant_app, business named in the verified
// token's claims. Everything is rolled back afterwards unless `keep` is set.
async function asTenant(db, claims, fn, { keep = false, role = "tenant_app" } = {}) {
  let result;
  await db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    if (claims !== undefined) await tx.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    result = await fn(tx);
    if (!keep) await tx.rollback();
  }).catch((e) => { if (!/rollback/i.test(String(e?.message))) throw e; });
  return result;
}
const claimsFor = (tenant) => JSON.stringify({ role: "tenant_app", tenant_id: tenant });

// ------------------------------------------------------------------ checks
describe("tenant isolation", () => {
  let db, A, B, tables;
  const held = {};
  before(async () => {
    db = await buildDatabase();
    ({ A, B } = await seedTwoBusinesses(db));
    tables = await tenantTables(db);
    // What each business really holds, read past row level security. A
    // business can own rows from before the seed (its business_details).
    for (const t of tables) {
      held[t] = (await db.query(`select
        count(*) filter (where tenant_id = $1)::int a, count(*) filter (where tenant_id = $2)::int b from ${t}`, [A, B])).rows[0];
    }
  });

  test("every app table carries a tenant_id, and the checks know all of them", async () => {
    const all = (await db.query(`select table_name as t from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows.map((r) => r.t);
    const withoutTenant = all.filter((t) => !tables.includes(t) && !["tenants", "schema_migrations"].includes(t));
    assert.deepEqual(withoutTenant, [], `tables with no tenant_id column: ${withoutTenant.join(", ")}`);
    const unseeded = tables.filter((t) => !SEED[t]);
    assert.deepEqual(unseeded, [], `add a row template to SEED for: ${unseeded.join(", ")}`);
  });

  test("every tenant table has row level security on and the tenant policy", async () => {
    const rows = (await db.query(`
      select c.relname as t, c.relrowsecurity as rls,
             exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'tenant_isolation') as policy
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any($1)`, [tables])).rows;
    for (const r of rows) {
      assert.ok(r.rls, `${r.t}: row level security is off`);
      assert.ok(r.policy, `${r.t}: no tenant_isolation policy`);
    }
    assert.equal(rows.length, tables.length);
  });

  test("tenant_app cannot bypass row level security", async () => {
    const r = (await db.query("select rolbypassrls, rolsuper from pg_roles where rolname = 'tenant_app'")).rows[0];
    assert.equal(r.rolbypassrls, false);
    assert.equal(r.rolsuper, false);
  });

  test("a business sees exactly its own rows in every table", async () => {
    for (const t of tables) {
      const [mine, theirs] = await asTenant(db, claimsFor(A), async (tx) => [
        (await tx.query(`select count(*)::int n from ${t}`)).rows[0].n,
        (await tx.query(`select count(*)::int n from ${t} where tenant_id = $1`, [B])).rows[0].n,
      ]);
      assert.ok(held[t].b > 0, `${t}: the seed gave business B no rows, so this check proves nothing`);
      assert.equal(mine, held[t].a, `${t}: business A sees ${mine} rows, expected its own ${held[t].a}`);
      assert.equal(theirs, 0, `${t}: business A can see business B's rows`);
    }
  });

  test("a business cannot change or delete another business's rows", async () => {
    for (const t of tables) {
      const [updated, deleted] = await asTenant(db, claimsFor(A), async (tx) => [
        (await tx.query(`update ${t} set tenant_id = tenant_id where tenant_id = $1`, [B])).affectedRows,
        (await tx.query(`delete from ${t} where tenant_id = $1`, [B])).affectedRows,
      ]);
      assert.equal(updated, 0, `${t}: business A updated business B's rows`);
      assert.equal(deleted, 0, `${t}: business A deleted business B's rows`);
      const stillThere = (await db.query(`select count(*)::int n from ${t} where tenant_id = $1`, [B])).rows[0].n;
      assert.equal(stillThere, held[t].b, `${t}: business B's rows changed`);
    }
  });

  test("a business cannot write a row into another business, or move one there", async () => {
    for (const t of tables) {
      if (t === "staff_sessions" || t === "staff_shifts") continue; // their templates look up B's parent row, which A cannot see
      const [sql, params] = SEED[t](`X${t}`);
      await assert.rejects(
        asTenant(db, claimsFor(A), (tx) => tx.query(sql, [...params, B])),
        /row-level security/,
        `${t}: business A inserted a row for business B`
      );
      await assert.rejects(
        asTenant(db, claimsFor(A), (tx) => tx.query(`update ${t} set tenant_id = $1`, [B])),
        /row-level security/,
        `${t}: business A moved its rows to business B`
      );
    }
  });

  test("a row saved without a tenant lands in the requesting business", async () => {
    const tenant = await asTenant(db, claimsFor(B), async (tx) => {
      await tx.query(`insert into settings (key, value) values ('saved_by_b', '{}')`);
      await tx.query(`insert into promo_codes (code, percent_off) values ('SAVEDBYB', 5)`);
      return (await tx.query(`select tenant_id from settings where key = 'saved_by_b'`)).rows[0].tenant_id;
    });
    assert.equal(tenant, B);
  });

  test("looking up another business's name finds nothing", async () => {
    // What the portal's "already exists" checks do: look a name up by itself.
    const found = await asTenant(db, claimsFor(A), async (tx) => ({
      room: (await tx.query("select 1 from experiences where id = 'room-B0'")).rows.length,
      promo: (await tx.query("select 1 from promo_codes where code = 'PROMOB0'")).rows.length,
      staff: (await tx.query("select 1 from staff_accounts where email = 'staff-B0@example.invalid'")).rows.length,
      setting: (await tx.query("select 1 from settings where key = 'setting_B0'")).rows.length,
      booking: (await tx.query("select 1 from bookings where reference = 'VB-B0'")).rows.length,
    }));
    assert.deepEqual(found, { room: 0, promo: 0, staff: 0, setting: 0, booking: 0 });
  });

  test("database functions only ever count the requesting business", async () => {
    const r = await asTenant(db, claimsFor(A), async (tx) => ({
      window: (await tx.query("select count(*)::int n from bookings_in_window('2020-01-01', '2030-01-01')")).rows[0].n,
      roster: (await tx.query("select count(*)::int n from customer_roster(null, false, null, 1000, 0)")).rows[0].n,
      bookingsRoster: (await tx.query("select count(*)::int n from bookings_roster()")).rows[0].n,
      vouchers: (await tx.query("select voucher_totals() as v")).rows[0].v.total,
      products: (await tx.query("select coalesce(sum(issued), 0)::int n from voucher_product_stats()")).rows[0].n,
    }));
    assert.equal(r.window, ROWS.A, "bookings_in_window leaked");
    assert.equal(r.bookingsRoster, ROWS.A, "bookings_roster leaked");
    assert.equal(r.vouchers, ROWS.A, "voucher_totals leaked");
    assert.equal(r.products, ROWS.A, "voucher_product_stats leaked");
    // customers + stats rows for A, merged by email: never any of B's.
    const bEmails = await asTenant(db, claimsFor(A), async (tx) =>
      (await tx.query("select count(*)::int n from customer_roster(null, false, null, 1000, 0) where email like '%B%'")).rows[0].n);
    assert.equal(bEmails, 0, "customer_roster leaked business B's customers");
    assert.ok(r.roster >= ROWS.A);
  });

  test("a booking's stats trigger writes to the booking's own business only", async () => {
    const [aStats, bVisible] = await asTenant(db, claimsFor(A), async (tx) => {
      await tx.query(`insert into bookings (reference, customer, items, pricing) values ('VB-TRIG', '{"email":"trigger@example.invalid"}', '[{"quantity":3}]', '{"paidCents":0}')`);
      return [
        (await tx.query(`select tenant_id from booking_email_stats where key = 'trigger@example.invalid'`)).rows,
        (await tx.query(`select count(*)::int n from booking_email_stats where tenant_id = $1`, [B])).rows[0].n,
      ];
    });
    assert.equal(aStats.length, 1);
    assert.equal(aStats[0].tenant_id, A);
    assert.equal(bVisible, 0);
  });

  test("a business can read its own tenant row and no other", async () => {
    const rows = await asTenant(db, claimsFor(A), async (tx) => (await tx.query("select id from tenants")).rows);
    assert.deepEqual(rows.map((r) => r.id), [A]);
  });

  test("the token lib/tenant-token.ts signs is read by the policies as intended", async () => {
    // The Data API verifies the signature and hands Postgres the payload as
    // request.jwt.claims; this is that payload, straight from the app's signer.
    const payload = Buffer.from(signTenantToken({ apikey: "k", secret: "s".repeat(40), tenantId: B }).split(".")[1], "base64url").toString();
    const counts = await asTenant(db, payload, async (tx) => ({
      bookings: (await tx.query("select count(*)::int n from bookings")).rows[0].n,
      foreign: (await tx.query("select count(*)::int n from bookings where tenant_id = $1", [A])).rows[0].n,
    }));
    assert.equal(counts.bookings, held.bookings.b, "the app's token didn't reach its own business");
    assert.equal(counts.foreign, 0, "the app's token reached another business");
  });

  test("a missing, partial or unknown business in the token sees nothing", async () => {
    const cases = {
      "running as tenant_app with no token at all": undefined,
      "claims with no tenant": JSON.stringify({ role: "tenant_app" }),
      "empty tenant": JSON.stringify({ role: "tenant_app", tenant_id: "" }),
      "a business that doesn't exist": claimsFor(randomUUID()),
    };
    for (const [label, claims] of Object.entries(cases)) {
      for (const t of tables) {
        const n = await asTenant(db, claims, async (tx) => (await tx.query(`select count(*)::int n from ${t}`)).rows[0].n);
        assert.equal(n, 0, `${label}: ${t} returned ${n} rows`);
      }
    }
  });

  test("a malformed tenant in the token is an error, never a row", async () => {
    await assert.rejects(
      asTenant(db, JSON.stringify({ role: "tenant_app", tenant_id: "not-a-uuid" }), (tx) => tx.query("select count(*) from bookings")),
      /invalid input syntax for type uuid/
    );
  });

  test("anon and authenticated (e.g. a Supabase Auth signup) reach no business's rows", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const t of tables) {
        const outcome = await asTenant(db, claimsFor(A), async (tx) => {
          try {
            return (await tx.query(`select count(*)::int n from ${t}`)).rows[0].n;
          } catch (e) {
            return /permission denied/.test(e.message) ? "denied" : e.message;
          }
        }, { role });
        assert.ok(outcome === 0 || outcome === "denied", `${role} on ${t}: ${outcome}`);
      }
    }
  });

  test("the service_role key the app uses today still sees its venue's rows (unchanged until a venue switches)", async () => {
    // Every check above ran inside a transaction that was rolled back, so the
    // table holds exactly what was seeded — and service_role sees all of it.
    await db.exec("set role service_role");
    try {
      const n = (await db.query("select count(*)::int n from promo_codes")).rows[0].n;
      assert.equal(n, ROWS.A + ROWS.B);
    } finally {
      await db.exec("reset role");
    }
  });
});

describe("two businesses in one database, once the old whole-table rules are gone", () => {
  let db, A, B;
  before(async () => {
    db = await buildDatabase();
    A = (await db.query("select id from tenants order by created_at limit 1")).rows[0].id;
    B = (await db.query("insert into tenants (name) values ('Business B') returning id")).rows[0].id;
    // The contract half of migration 0003, rehearsed here ahead of its migration.
    await db.exec(`
      alter table experiences drop constraint experiences_pkey;
      alter table promo_codes drop constraint promo_codes_pkey;
      alter table staff_accounts drop constraint staff_accounts_email_key;
      alter table customers drop constraint customers_pkey;
      alter table booking_email_stats drop constraint booking_email_stats_pkey;
      alter table settings drop constraint settings_pkey;
      alter table bookings drop constraint bookings_reference_key;`);
  });

  test("each can create the same room name, promo code, staff email, customer and setting", async () => {
    for (const tenant of [A, B]) {
      await asTenant(db, claimsFor(tenant), async (tx) => {
        await tx.query(`insert into experiences (id, name) values ('blackbeards-brig', 'Blackbeard''s Brig')`);
        await tx.query(`insert into promo_codes (code, percent_off) values ('WELCOME10', 10)`);
        await tx.query(`insert into staff_accounts (email, name, password_hash) values ('owner@example.invalid', 'Owner', 'x')`);
        await tx.query(`insert into customers (email, first_name, last_name) values ('pat@example.invalid', 'Pat', 'Lee')`);
        await tx.query(`insert into settings (key, value) values ('booking_site', '{}') on conflict (tenant_id, key) do update set value = excluded.value`);
      }, { keep: true });
    }
    const counts = (await db.query(`select
      (select count(*)::int from experiences where id = 'blackbeards-brig') rooms,
      (select count(*)::int from promo_codes where code = 'WELCOME10') promos,
      (select count(*)::int from staff_accounts where email = 'owner@example.invalid') staff`)).rows[0];
    assert.deepEqual(counts, { rooms: 2, promos: 2, staff: 2 });
  });

  test("the portal's 'already exists' check only sees the business's own room", async () => {
    const seenByA = await asTenant(db, claimsFor(A), async (tx) =>
      (await tx.query(`select tenant_id from experiences where id = 'blackbeards-brig'`)).rows);
    assert.equal(seenByA.length, 1);
    assert.equal(seenByA[0].tenant_id, A);
  });

  test("but no business can hold the same promo code twice", async () => {
    await assert.rejects(
      asTenant(db, claimsFor(A), (tx) => tx.query(`insert into promo_codes (code, percent_off) values ('WELCOME10', 20)`)),
      /duplicate key/
    );
  });

  test("the same customer booking at both businesses gets separate stats", async () => {
    for (const tenant of [A, B]) {
      await asTenant(db, claimsFor(tenant), (tx) =>
        tx.query(`insert into bookings (reference, customer, items, pricing) values ('VB-SAME01', '{"email":"shared@example.invalid"}', '[{"quantity":4}]', '{"paidCents":1000}')`),
        { keep: true });
    }
    const perTenant = (await db.query(`select tenant_id, bookings from booking_email_stats where key = 'shared@example.invalid' order by tenant_id`)).rows;
    assert.equal(perTenant.length, 2);
    assert.ok(perTenant.every((r) => r.bookings === 1), "one business's booking was counted in the other's stats");
  });
});

describe("the migration can be undone", () => {
  test("rollback removes the policies and role, and 0004 re-applies cleanly", async () => {
    const db = await buildDatabase();
    await db.exec(read("migrations/rollback/0004_tenant-isolation.down.sql"));
    assert.equal((await db.query("select count(*)::int n from pg_roles where rolname = 'tenant_app'")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from pg_policies where policyname in ('tenant_isolation', 'tenant_self')")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from schema_migrations where version = '0004'")).rows[0].n, 0);
    assert.ok((await db.query("select public.current_tenant_id() as t")).rows[0].t, "current_tenant_id() no longer answers");
    await db.exec(read("migrations/rollback/0004_tenant-isolation.down.sql")); // twice is harmless
    await db.query("select public._migrate_exec($1)", [read("migrations/0004_tenant-isolation.sql")]);
    assert.equal((await db.query("select count(*)::int n from pg_policies where policyname = 'tenant_isolation'")).rows[0].n, (await tenantTables(db)).length);
  });
});
