-- How a request finds its business: by web address, by staff session, or by
-- the email a member of staff signs in with.
--
-- Until now each deployment was pinned to one business (VENUE_TENANT_ID), which
-- is how Enigma and Time Zone still run and will until they move into the
-- shared database. A deployment that serves many businesses can't be pinned:
-- it has to work out, per request, whose request it is. That lookup has to
-- happen BEFORE a business is known — the one moment the "see only your own
-- rows" policies can't apply — so it is done by three security definer
-- functions that each answer with a tenant id and nothing else:
--
--   tenant_for_host(host)          enigmaescapes.voltrisbooking.com → Enigma
--   tenant_for_session(token_hash) a staff cookie → the business it belongs to
--   tenant_for_staff_email(email)  a sign-in → the business, if exactly one
--                                  active account has that email
--
-- The last two exist for an app: a phone app has no web address, so it names
-- its business through the member of staff using it. An email held by accounts
-- at two businesses (allowed since 0013) resolves to nothing; that person signs
-- in at their venue's address instead.
--
-- tenant_hosts holds every address a business answers at: its
-- <slug>.voltrisbooking.com, and later any domain of its own. It is a tenant
-- table like any other — a business can read and manage its own addresses —
-- but the lookup function reads it for everyone, which is the point.

-- A slug is a label in a hostname: lower-case letters, digits and hyphens,
-- not starting or ending with a hyphen, at most 63 characters.
do $block$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_slug_format') then
    alter table public.tenants
      add constraint tenants_slug_format
      check (slug is null or slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$');
  end if;
end
$block$;

create table if not exists public.tenant_hosts (
  host        text primary key,                   -- lower-case, no port
  tenant_id   uuid not null default public.current_tenant_id() references public.tenants (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.tenant_hosts enable row level security;
grant select, insert, update, delete on public.tenant_hosts to tenant_app;
drop policy if exists tenant_isolation on public.tenant_hosts;
create policy tenant_isolation on public.tenant_hosts for all to tenant_app
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create index if not exists tenant_hosts_tenant on public.tenant_hosts (tenant_id);

-- Lower-cased, port removed: "Enigma.Voltrisbooking.com:443" is the same site.
create or replace function public.tenant_for_host(p_host text) returns uuid
language sql stable security definer set search_path = public as $fn$
  select h.tenant_id
    from tenant_hosts h
   where h.host = lower(split_part(coalesce(p_host, ''), ':', 1))
   limit 1
$fn$;

create or replace function public.tenant_for_session(p_token_hash text) returns uuid
language sql stable security definer set search_path = public as $fn$
  select s.tenant_id
    from staff_sessions s
   where s.token_hash = p_token_hash
     and s.expires_at > now()
   limit 1
$fn$;

-- Exactly one active account with this email, or nothing: an ambiguous email
-- must not pick a business on someone's behalf.
create or replace function public.tenant_for_staff_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $fn$
  select case when count(*) = 1 then min(a.tenant_id::text)::uuid end
    from staff_accounts a
   where lower(a.email) = lower(trim(coalesce(p_email, '')))
     and a.active
$fn$;

-- Callable by the app's own role, with a token that names no business yet.
-- Nothing else may call them: anon and authenticated are the public roles.
revoke all on function public.tenant_for_host(text) from public, anon, authenticated;
revoke all on function public.tenant_for_session(text) from public, anon, authenticated;
revoke all on function public.tenant_for_staff_email(text) from public, anon, authenticated;
grant execute on function public.tenant_for_host(text) to tenant_app;
grant execute on function public.tenant_for_session(text) to tenant_app;
grant execute on function public.tenant_for_staff_email(text) to tenant_app;

notify pgrst, 'reload schema';
