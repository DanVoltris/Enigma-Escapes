// A real PostgreSQL (PGlite) built the way every venue's is: scripts/schema.sql,
// then the migrations in order, through _migrate_exec exactly as the runner
// sends them. Shared by the tenant-isolation checks and any test that needs to
// exercise SQL rather than TypeScript.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const read = (p) => readFileSync(join(ROOT, p), "utf8");

export const migrationFiles = () =>
  readdirSync(join(ROOT, "migrations"))
    .filter((f) => /^\d{4}_[a-z0-9-]+\.sql$/.test(f))
    .sort();

// One migration, sent the way scripts/migrate.mjs sends it.
export async function applyMigration(db, file) {
  const version = file.slice(0, 4);
  const sql =
    read(`migrations/${file}`).trim().replace(/;?$/, ";") +
    `\ninsert into schema_migrations (version, name, checksum) values ('${version}', '${file}', 'test');`;
  await db.exec("set role service_role");
  try {
    await db.query("select public._migrate_exec($1)", [sql]);
  } finally {
    await db.exec("reset role");
  }
}

// `through` stops after that migration, so a test can set up the data a later
// migration will have to cope with — which is the only honest way to check a
// backfill.
export async function buildDatabase({ through = "9999" } = {}) {
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
  for (const f of migrationFiles()) {
    if (f.slice(0, 4) > through) break;
    await applyMigration(db, f);
  }
  return db;
}

// Runs `fn` as the app will: role tenant_app, business named in the verified
// token's claims. Everything is rolled back afterwards unless `keep` is set.
export async function asTenant(db, claims, fn, { keep = false, role = "tenant_app" } = {}) {
  let result;
  await db
    .transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      if (claims !== undefined) await tx.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      result = await fn(tx);
      if (!keep) await tx.rollback();
    })
    .catch((e) => {
      if (!/rollback/i.test(String(e?.message))) throw e;
    });
  return result;
}

export const claimsFor = (tenant) => JSON.stringify({ role: "tenant_app", tenant_id: tenant });
