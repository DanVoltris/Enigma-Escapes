-- Undo migrations/0014_tenant-hosts.sql on one venue. Paste into that venue's
-- SQL editor only if 0014 has to come off — and only while every deployment
-- reaching it is pinned with VENUE_TENANT_ID, since an unpinned one resolves
-- its business through what this removes. Touches no business data; the
-- addresses in tenant_hosts are lost.
do $block$
begin
  drop function if exists public.tenant_for_host(text);
  drop function if exists public.tenant_for_session(text);
  drop function if exists public.tenant_for_staff_email(text);
  drop table if exists public.tenant_hosts;
  alter table public.tenants drop constraint if exists tenants_slug_format;
  delete from schema_migrations where version = '0014';
end
$block$;
notify pgrst, 'reload schema';
