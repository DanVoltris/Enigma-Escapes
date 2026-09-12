# Database migrations

Every schema change goes in here, as one numbered file, applied to every venue
by `scripts/migrate.mjs`. This exists because there is no longer one database:
Enigma and Time Zone each have their own Supabase project, and every venue added
after them will too. A change pasted into one dashboard and forgotten in another
is how venues end up silently running different schemas — which produces bugs
that only reproduce at one customer.

## Running it

Always point `--env-file` at the venue you mean. There is deliberately no npm
script: one that hardcoded `.env.local` would aim every venue's migration at
Enigma, the trap `npm run import:*` already carries a warning about.

```
node --env-file=.env.local    scripts/migrate.mjs             # dry run — what would happen
node --env-file=.env.local    scripts/migrate.mjs --apply      # do it
node --env-file=.env.timezone scripts/migrate.mjs --status     # what this venue has had
```

Dry run is the default, the same as `seed-venue.mjs`. Re-running is a no-op.

First time on a database that predates the runner (Enigma, Time Zone), it will
say the `_migrate_exec` function is missing and print the ~15 lines to paste
into that project's SQL editor. That is a one-time step per venue. A brand-new
venue gets it for free: it is part of `scripts/schema.sql` now.

## Writing one

Name it `NNNN_lowercase-with-dashes.sql`, taking the next free number. `0000` is
reserved for `scripts/schema.sql`, the baseline.

**Every migration must be idempotent** — `if not exists`, `create or replace`,
`add column if not exists` — exactly as `schema.sql` already is.
`schema_migrations` is what stops a file running twice; idempotency is what
saves you when a database predates the runner, or when `schema.sql` is
regenerated from live and folds an old migration into the baseline.

```sql
-- 0001_promo-staff-only.sql
-- Lets a promo code be taken at the desk without appearing on the website.
alter table promo_codes add column if not exists staff_only boolean not null default false;
```

Each file runs inside a transaction, so a statement that raises rolls the whole
file back and nothing after it runs. Two consequences:

- You cannot use `create index concurrently`, or anything else Postgres refuses
  inside a transaction. Do those by hand in the SQL editor.
- A migration can never end up applied but unrecorded — the bookkeeping row is
  written in the same transaction as the change.

## Don't edit one that has already run

The runner stores a checksum and refuses to continue if an applied file changed,
because what you edited did *not* reach the databases that already ran it.
Write the change as a new migration. (`--force` accepts the new checksum without
running anything — only for a comment-only edit you are certain about.)

## Where the old files went

`scripts/*.sql` are the historical record of how Enigma's database got here,
applied by hand before this existed. They are already folded into `schema.sql`,
which was generated from the live database. Leave them alone; don't add to them.
