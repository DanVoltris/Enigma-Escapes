-- The first step towards one shared database for every venue: each row learns
-- which business it belongs to. It changes no behaviour at all.
--
-- Today every venue has its own database, so every row in it belongs to that
-- venue, and this migration writes that down. It creates a one-row `tenants`
-- table for the venue and adds `tenant_id` to every app table. Existing rows
-- are filled in, and new rows get it by default, so no code has to send it.
-- The app ignores the column: every select=* row goes through a mapper that
-- picks fields by name.
--
-- Two decisions worth knowing:
--
-- Each venue gets its OWN random tenant id, not a shared constant. When the
-- venues later move into one database, Enigma's rows and Time Zone's rows must
-- arrive under different tenants. A constant like "tenant 1" everywhere would
-- merge them into one business on the day of the move.
--
-- The default is a function, current_tenant_id(), not a literal. For now it
-- returns this database's one tenant. When isolation arrives it will instead
-- read the tenant from the request's JWT claim, and only the function body
-- changes, not a default on twenty-two tables. It is created only if absent,
-- so re-applying this file by hand after that change can't undo it.
--
-- It refuses to run on a database that is missing a baseline table rather
-- than skipping it. A venue that is behind the baseline would otherwise end up
-- with some tables tenant-aware and some not, and that surfaces much later as
-- a failed move. The whole file rolls back and names the missing tables.

create table if not exists tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique,            -- the subdomain; set when hostname routing arrives
  created_at timestamptz not null default now()
);
alter table tenants enable row level security;

-- The venue itself, named from its own business details where it has them.
insert into tenants (name)
select coalesce(
  nullif(trim((select value ->> 'companyName' from settings where key = 'business_details')), ''),
  'Unnamed venue'
)
where not exists (select 1 from tenants);

do $block$
begin
  if to_regprocedure('public.current_tenant_id()') is null then
    -- security definer so the default works whatever the inserting role may
    -- read. Only service_role may call it, the one role the app uses today.
    -- When isolation moves the app onto its own role, that role gets EXECUTE
    -- here as part of the same change.
    execute $fn$
      create function public.current_tenant_id() returns uuid
      language sql stable security definer set search_path = public
      as $body$ select id from tenants order by created_at limit 1 $body$
    $fn$;
    revoke all on function public.current_tenant_id() from public;
    revoke all on function public.current_tenant_id() from anon, authenticated;
    grant execute on function public.current_tenant_id() to service_role;
  end if;
end
$block$;

do $block$
declare
  -- Every app table in scripts/schema.sql. Not schema_migrations (it describes
  -- the database, not a business) and not tenants itself.
  app_tables text[] := array[
    'experiences', 'bookings', 'customers', 'promo_codes', 'gift_vouchers',
    'voucher_products', 'reward_codes', 'booking_requests', 'slot_blocks',
    'taxes', 'location_hours', 'settings', 'staff_accounts', 'staff_sessions',
    'staff_members', 'staff_shifts', 'staff_notes', 'activity_log', 'feedback',
    'quotes', 'site_events', 'booking_email_stats'
  ];
  missing text[] := '{}';
  t text;
begin
  foreach t in array app_tables loop
    if to_regclass('public.' || t) is null then
      missing := missing || t;
    end if;
  end loop;

  if cardinality(missing) > 0 then
    raise exception 'This database is missing tables the baseline defines: %. Nothing was changed. Run scripts/schema.sql on this venue first (it is idempotent and keeps existing data), then run the migration again.',
      array_to_string(missing, ', ');
  end if;

  foreach t in array app_tables loop
    -- One tenant per row, never null, and never pointing at a tenant that
    -- doesn't exist. The default fills existing rows and every future insert.
    execute format(
      'alter table public.%I add column if not exists tenant_id uuid not null default public.current_tenant_id() references public.tenants (id)',
      t
    );
  end loop;
end
$block$;

notify pgrst, 'reload schema';
