// Applies this repo's database migrations to one venue's Supabase project.
//
//   node --env-file=.env.local    scripts/migrate.mjs             what would run (dry run)
//   node --env-file=.env.local    scripts/migrate.mjs --apply      run it
//   node --env-file=.env.timezone scripts/migrate.mjs --status     what is already applied
//
// Point --env-file at the venue you mean. There is deliberately no npm script:
// one that hardcoded .env.local would quietly aim every venue's migration at
// Enigma, the same trap the importers carry a warning about.
//
// How it reaches the database
// ---------------------------
// PostgREST serves rows, not DDL, so a migration cannot go down the same path
// lib/supabase.ts uses for everything else. Instead each database carries one
// function, _migrate_exec(sql text), and this script calls it over RPC with the
// service key it already has — the same rpc/… route lib/vouchers.ts and
// lib/customers.ts already use. No new dependency, no new secret, no database
// password, and nothing reachable without the service key (the function is
// revoked from anon and authenticated). If it is missing the script prints the
// SQL to create it and stops; that is a one-time paste per venue.
//
// Each migration is atomic for free: a function call is itself a transaction,
// so a statement that raises rolls the whole file back. The bookkeeping row is
// written inside that same call, so a migration can never end up applied but
// unrecorded. The one thing that cannot work this way is a command Postgres
// refuses to run inside a transaction — `create index concurrently` is the one
// you are likely to want. Do that by hand in the SQL editor.
//
// Migrations must still be idempotent (`if not exists`, `create or replace`),
// exactly as scripts/schema.sql is. schema_migrations stops a file running
// twice; idempotency is what saves you when a database predates the runner, or
// when schema.sql is regenerated and folds an old migration in.
import { readFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(ROOT, "migrations");
const BASELINE = join(ROOT, "scripts", "schema.sql");
// The baseline records itself in schema_migrations under this number, so a
// database is only ever asked for it once and --status can say so honestly.
const BASELINE_VERSION = "0000";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const statusOnly = args.includes("--status");
const force = args.includes("--force");

const unknown = args.filter((a) => !["--apply", "--status", "--force"].includes(a));
if (unknown.length) {
  console.error(`Unknown option: ${unknown.join(" ")}`);
  console.error("Usage: node --env-file=.env.<venue> scripts/migrate.mjs [--status] [--apply] [--force]");
  process.exit(1);
}

// Same tolerance as lib/supabase.ts: the variable is often pasted with /rest/v1 on the end.
const BASE = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!BASE || !KEY) {
  console.error(
    "No database configured. Pass the venue's own env file, e.g.\n" +
      "  node --env-file=.env.timezone scripts/migrate.mjs\n" +
      "It must set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}
if (process.env.USE_LOCAL_DATA === "true" || process.env.USE_LOCAL_DATA === "1") {
  console.error(
    "USE_LOCAL_DATA is set, so this env file runs on the local JSON store, which has no schema to migrate.\n" +
      "Delete .local-data.json to reset that instead."
  );
  process.exit(1);
}

function rest(path, init) {
  return fetch(`${BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

async function fail(res, doing) {
  const body = await res.text().catch(() => "");
  throw new Error(`${doing} failed (Supabase ${res.status}): ${body.slice(0, 500)}`);
}

// Runs one SQL string on the database. Returns nothing; throws with the
// database's own message on error.
async function exec(sql) {
  const res = await rest("rpc/_migrate_exec", { method: "POST", body: JSON.stringify({ sql }) });
  if (res.status === 404) return "missing";
  if (!res.ok) await fail(res, "Running SQL");
  return "ok";
}

const BOOTSTRAP = `-- Lets scripts/migrate.mjs run migrations over the service key.
-- Paste this into the Supabase SQL editor once per venue, then re-run migrate.
create or replace function _migrate_exec(sql text) returns void
language plpgsql security definer set search_path = public as $fn$
begin execute sql; end;
$fn$;
-- Reachable only with the service_role key, which already bypasses RLS anyway.
revoke all on function _migrate_exec(text) from public;
revoke all on function _migrate_exec(text) from anon, authenticated;
create table if not exists schema_migrations (
  version    text primary key,
  name       text not null,
  checksum   text not null,
  applied_at timestamptz not null default now()
);
alter table schema_migrations enable row level security;
notify pgrst, 'reload schema';`;

// ------------------------------------------------------------------ the files
const NAME = /^(\d{4})_([a-z0-9-]+)\.sql$/;

function loadMigrations() {
  let entries;
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch {
    return [];
  }
  const sql = entries.filter((f) => f.endsWith(".sql")).sort();
  const bad = sql.filter((f) => !NAME.test(f));
  if (bad.length) {
    console.error(
      `These files in migrations/ are not named NNNN_lowercase-with-dashes.sql, so their order is undefined:\n  ${bad.join("\n  ")}\n` +
        "Rename them and re-run."
    );
    process.exit(1);
  }
  const out = sql.map((file) => {
    const [, version, name] = file.match(NAME);
    const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    return { file, version, name, body, checksum: createHash("sha256").update(body).digest("hex").slice(0, 16) };
  });
  const reserved = out.filter((m) => m.version === BASELINE_VERSION);
  if (reserved.length) {
    console.error(`${reserved[0].file}: ${BASELINE_VERSION} is reserved for the baseline (scripts/schema.sql). Start at 0001.`);
    process.exit(1);
  }
  const seen = new Map();
  for (const m of out) {
    if (seen.has(m.version)) {
      console.error(`Two migrations share the number ${m.version}: ${seen.get(m.version)} and ${m.file}. Renumber one.`);
      process.exit(1);
    }
    seen.set(m.version, m.file);
  }
  return out;
}

// ------------------------------------------------------------------- the work
async function main() {
  const migrations = loadMigrations();

  // Is the runner installed on this database?
  if ((await exec("select 1")) === "missing") {
    console.error(
      "This database has no _migrate_exec function yet, so nothing can be applied.\n" +
        "Run the SQL below in the Supabase SQL editor (Dashboard → SQL Editor → New query),\n" +
        "then run this command again. It is only needed once per venue.\n\n" +
        BOOTSTRAP +
        "\n"
    );
    process.exit(1);
  }

  // A database with no experiences table has never had schema.sql run on it.
  const probe = await rest("experiences?select=id&limit=1");
  if (!probe.ok && probe.status !== 404) await fail(probe, "Reading experiences");
  const fresh = probe.status === 404;

  // schema_migrations comes from the bootstrap, but a database bootstrapped by
  // an older copy of this script may not have it.
  let appliedRes = await rest("schema_migrations?select=version,name,checksum&order=version");
  if (appliedRes.status === 404) {
    if (!apply) {
      console.log("schema_migrations does not exist yet — it would be created.");
    } else {
      await exec(
        `create table if not exists schema_migrations (
           version text primary key, name text not null, checksum text not null,
           applied_at timestamptz not null default now());
         alter table schema_migrations enable row level security;
         notify pgrst, 'reload schema';`
      );
      appliedRes = await rest("schema_migrations?select=version,name,checksum&order=version");
    }
  }
  const applied = appliedRes.ok ? await appliedRes.json() : [];
  const appliedBy = new Map(applied.map((r) => [r.version, r]));

  if (statusOnly) {
    console.log(`Database: ${BASE}`);
    const base = appliedBy.get(BASELINE_VERSION);
    console.log(
      base
        ? "  0000  baseline                             applied"
        : fresh
          ? "  0000  baseline                             pending (empty database)"
          : "  0000  baseline                             present but unrecorded (pre-dates this runner)"
    );
    if (!migrations.length) console.log("\nNo migrations in migrations/ yet.");
    for (const m of migrations) {
      const row = appliedBy.get(m.version);
      const mark = !row ? "pending" : row.checksum === m.checksum ? "applied" : "applied, FILE CHANGED SINCE";
      console.log(`  ${m.version}  ${m.name.padEnd(36)} ${mark}`);
    }
    const orphans = applied.filter((r) => r.version !== BASELINE_VERSION && !migrations.some((m) => m.version === r.version));
    for (const r of orphans) console.log(`  ${r.version}  ${r.name.padEnd(36)} applied, no file in this checkout`);
    return;
  }

  // A migration whose file changed after it ran is either an edit that never
  // reached this database or a database that is not what the repo thinks.
  // Either way the diff is invisible from here, so say so rather than guess.
  const drifted = migrations.filter((m) => appliedBy.has(m.version) && appliedBy.get(m.version).checksum !== m.checksum);
  if (drifted.length && !force) {
    console.error(
      "These migrations already ran here, but their files have changed since:\n  " +
        drifted.map((m) => m.file).join("\n  ") +
        "\nWhat changed has NOT been applied. Write the change as a new migration instead" +
        "\n(editing an applied one leaves every other venue behind). --force accepts the" +
        "\nnew checksums without running anything."
    );
    process.exit(1);
  }
  if (drifted.length && force) {
    if (apply) {
      for (const m of drifted) {
        await exec(`update schema_migrations set checksum = '${m.checksum}' where version = '${m.version}'`);
      }
      console.log(`Accepted new checksums for ${drifted.length} migration(s) without running them.`);
    } else {
      console.log(`Would accept new checksums for: ${drifted.map((m) => m.file).join(", ")}`);
    }
  }

  const pending = migrations.filter((m) => !appliedBy.has(m.version));

  // ------------------------------------------------------------------ plan
  const plan = [];
  if (!appliedBy.has(BASELINE_VERSION)) {
    const body = readFileSync(BASELINE, "utf8");
    const sum = createHash("sha256").update(body).digest("hex").slice(0, 16);
    const record = `insert into schema_migrations (version, name, checksum) values ('${BASELINE_VERSION}', 'baseline', '${sum}')\non conflict (version) do update set checksum = excluded.checksum, applied_at = now();`;
    plan.push(
      fresh
        ? { label: "0000      baseline (scripts/schema.sql — empty database)", run: () => exec(`${body}\n${record}`) }
        : {
            // Enigma and Time Zone predate this runner: they already have the
            // whole schema, so the baseline is recorded, not re-run.
            label: "0000      baseline (already present — recording it, no SQL run)",
            run: () => exec(record),
          }
    );
  }
  for (const m of pending) {
    plan.push({
      label: `${m.version}      ${m.name}`,
      run: async () => {
        const body = m.body.trim().replace(/;?$/, ";");
        // Migration and bookkeeping go in one call, so one transaction covers
        // both: a failure rolls back the schema change AND the record of it.
        await exec(
          `${body}\ninsert into schema_migrations (version, name, checksum) values ('${m.version}', '${m.name}', '${m.checksum}')\n` +
            `on conflict (version) do update set checksum = excluded.checksum, applied_at = now();`
        );
      },
    });
  }

  if (!plan.length) {
    console.log(`Up to date — ${migrations.length} migration(s) already applied to ${BASE}.`);
    return;
  }

  console.log(`Database: ${BASE}`);
  console.log(`${apply ? "Applying" : "Would apply"} ${plan.length} step(s):`);
  for (const step of plan) console.log(`  ${step.label}`);

  if (!apply) {
    console.log("\nDry run — nothing was changed. Add --apply to run it.");
    return;
  }

  for (const step of plan) {
    const started = Date.now();
    process.stdout.write(`  running ${step.label} … `);
    try {
      await step.run();
    } catch (err) {
      console.log("FAILED");
      console.error(`\n${err.message}\n\nThis step was rolled back. Nothing after it ran.`);
      process.exit(1);
    }
    console.log(`ok (${Date.now() - started}ms)`);
  }
  console.log(`\nDone — ${plan.length} step(s) applied.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
