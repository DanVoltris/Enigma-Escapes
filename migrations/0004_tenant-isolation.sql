-- The database itself keeps each business to its own rows. Changes nothing for
-- the app yet.
--
-- Until now isolation has been implicit: one database per venue, reached with
-- the service_role key, which skips every row level security policy. In one
-- shared database that key would show every business every row, and a single
-- query that forgot "where tenant_id = …" would be a data breach nobody sees.
-- This makes forgetting harmless instead: a query run as tenant_app only ever
-- touches rows of the business its request names, and a missing filter returns
-- nothing rather than everything.
--
-- How a request names its business: the app signs a short-lived JWT per
-- request, { role: "tenant_app", tenant_id: … }. The Data API verifies it,
-- switches to the tenant_app role, and exposes the claims to Postgres as the
-- request-local setting request.jwt.claims. Request-local matters: the API pools
-- connections, and a plain session setting could carry one business's id into
-- the next request on the same connection. The claims can't.
--
-- Nothing changes until an app runs as tenant_app. The service_role key the app
-- uses today bypasses these policies, and for it current_tenant_id() still
-- answers with the database's one tenant, so defaults on inserts behave as
-- before. Each venue moves to tenant_app separately (lib/supabase.ts), and moves
-- back by dropping its signing settings. That fallback is only sound while a
-- database holds one tenant; it must go before two businesses share one.
--
-- Roles other than tenant_app — anon, authenticated — get no policy at all, so
-- RLS denies them every row. That is deliberate: Supabase Auth tokens are role
-- "authenticated", and a signup through the project's public Auth endpoint must
-- not reach anyone's data.
--
-- Every table carrying a tenant_id is covered, found by the column rather than a
-- list, and tests/tenant-isolation.test.mjs fails if a table ever lacks either.

do $block$
begin
  if not exists (select 1 from pg_roles where rolname = 'tenant_app') then
    create role tenant_app nologin noinherit;
  end if;
end
$block$;

-- The Data API logs in as authenticator and switches to the role a verified
-- token names; it can only switch to roles granted to it.
grant tenant_app to authenticator;
grant usage on schema public to tenant_app;

-- Which business a request is for, decided by the role actually running, not
-- by what a token says. Running as tenant_app: the verified token's tenant_id
-- and nothing else — no token, no tenant, no rows; there is no fallback for this
-- role, ever. Running as anything else (the service_role key the app uses today,
-- the migration runner, the import scripts): the database's single tenant,
-- exactly as migration 0001 defined it. nullif guards the empty string the
-- setting reads as when unset.
--
-- security invoker, so current_user is the caller. That also keeps the tenants
-- lookup out of tenant_app's path: the tenants policy calls this function, and
-- a lookup there would recurse.
create or replace function public.current_tenant_id() returns uuid
language sql stable security invoker set search_path = public as $fn$
  select case
    when current_user = 'tenant_app'
      then nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id', '')::uuid
    else (select id from tenants order by created_at limit 1)
  end
$fn$;
grant execute on function public.current_tenant_id() to tenant_app;

do $block$
declare
  t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and tb.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to tenant_app', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    -- (select …) so the tenant is looked up once per statement, not per row.
    execute format(
      'create policy tenant_isolation on public.%I for all to tenant_app '
      'using (tenant_id = (select public.current_tenant_id())) '
      'with check (tenant_id = (select public.current_tenant_id()))',
      t
    );
  end loop;
end
$block$;

-- A business may read its own tenant row, and no other.
grant select on public.tenants to tenant_app;
drop policy if exists tenant_self on public.tenants;
create policy tenant_self on public.tenants for select to tenant_app
  using (id = (select public.current_tenant_id()));

-- The database functions the app calls. All run as the caller, so the policies
-- above apply inside them too: a roster or a total only ever sums one business.
grant execute on function public.bookings_in_window(date, date) to tenant_app;
grant execute on function public.customer_roster(text, boolean, text[], int, int) to tenant_app;
grant execute on function public.bookings_roster(text, text, text, text, text, date, date, timestamptz, text[], int, int) to tenant_app;
grant execute on function public.voucher_totals() to tenant_app;
grant execute on function public.voucher_product_stats() to tenant_app;
-- Called by the bookings trigger, in the booking writer's role.
grant execute on function public.refresh_booking_email_stats(text) to tenant_app;
grant execute on function public.booking_email_stats_sync() to tenant_app;

notify pgrst, 'reload schema';
