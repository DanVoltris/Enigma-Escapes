-- Undo migrations/0004_tenant-isolation.sql on one venue. Paste into that
-- venue's SQL editor only if 0004 has to come off — and switch the venue's app
-- back to the service_role key FIRST (remove its signing settings and redeploy):
-- an app running as tenant_app loses all access the moment this runs.
--
-- Drops the tenant policies and the tenant_app role, and puts
-- current_tenant_id() back to migration 0001's version. Row level security
-- stays on for every table, as it was before 0004. Touches no data.
begin;
do $block$
declare
  t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and tb.table_type = 'BASE TABLE'
  loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
  end loop;
end
$block$;
drop policy if exists tenant_self on public.tenants;

create or replace function public.current_tenant_id() returns uuid
language sql stable security definer set search_path = public as $fn$
  select id from tenants order by created_at limit 1
$fn$;

do $block$
begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    revoke tenant_app from authenticator;
    revoke all on all tables in schema public from tenant_app;
    revoke all on all functions in schema public from tenant_app;
    revoke usage on schema public from tenant_app;
    drop role tenant_app;
  end if;
end
$block$;

delete from schema_migrations where version = '0004';
commit;
notify pgrst, 'reload schema';
