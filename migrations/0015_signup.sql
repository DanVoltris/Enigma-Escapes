-- A business can create itself (Phase 3: sign-up).
--
-- create_tenant does, in one transaction, everything a venue file and the seed
-- script did by hand for Enigma and Time Zone: the business, its web address,
-- its owner's admin login, the settings the portal expects to find, and one
-- example room (switched off, so nothing is on sale until they say so). If any
-- part fails — the slug is taken, say — nothing is created.
--
-- It is called before the business exists, so like the lookups in 0014 it is
-- security definer and callable by tenant_app with a token that names no
-- business. Unlike them it writes, which is why it is careful: every row it
-- creates carries the new tenant's id explicitly (current_tenant_id() is null
-- for that token), it accepts only what the app has already validated and
-- re-checks the parts that matter (slug shape, uniqueness), and it returns the
-- new tenant id and nothing else. The password arrives already hashed; this
-- function never sees a password.
--
-- slug_available is the live check the form makes as the slug is typed.

create or replace function public.slug_available(p_slug text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select not exists (select 1 from tenants where slug = lower(trim(coalesce(p_slug, ''))))
$fn$;

create or replace function public.create_tenant(
  p_name           text,
  p_slug           text,
  p_host           text,   -- the address the app computed for the slug
  p_owner_name     text,
  p_owner_email    text,
  p_password_hash  text,
  p_permissions    jsonb,  -- the admin preset, from lib/permissions.ts
  p_timezone       text
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_tenant uuid;
  v_slug   text := lower(trim(coalesce(p_slug, '')));
  v_host   text := lower(trim(coalesce(p_host, '')));
  v_email  text := lower(trim(coalesce(p_owner_email, '')));
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' then raise exception 'slug_invalid'; end if;
  if v_host = '' then raise exception 'host_required'; end if;
  if v_email = '' or coalesce(p_password_hash, '') = '' then raise exception 'owner_required'; end if;
  if jsonb_typeof(p_permissions) is distinct from 'array' then raise exception 'permissions_required'; end if;
  if exists (select 1 from tenants where slug = v_slug) then raise exception 'slug_taken'; end if;
  if exists (select 1 from tenant_hosts where host = v_host) then raise exception 'host_taken'; end if;

  insert into tenants (name, slug) values (trim(p_name), v_slug) returning id into v_tenant;
  insert into tenant_hosts (host, tenant_id) values (v_host, v_tenant);

  insert into staff_accounts (email, name, password_hash, role, locations, permissions, active, tenant_id)
  values (v_email, trim(p_owner_name), p_password_hash, 'admin', '[]'::jsonb, p_permissions, true, v_tenant);

  insert into settings (key, value, tenant_id) values
    ('business_details', jsonb_build_object(
       'companyName', trim(p_name), 'phone', '', 'cell', '', 'email', v_email, 'website', '',
       'address', '', 'taxLabel', 'GST (Goods and Services Tax)', 'taxNumber', ''), v_tenant),
    ('locale', jsonb_build_object(
       'language', 'en-CA', 'currencyCode', 'CAD', 'currencySymbol', '$',
       'timezone', coalesce(nullif(trim(p_timezone), ''), 'America/Winnipeg'),
       'dateStyle', 'medium', 'timeFormat', '12', 'firstDay', 0), v_tenant),
    ('pricing_mode', '{"taxInclusive": false, "depositFlatCents": 0, "corporateFeeCents": 0}'::jsonb, v_tenant),
    ('dashboard', '{"hoursFromSchedule": true}'::jsonb, v_tenant);

  -- Something to rename rather than a blank portal. Off, so it is not for sale.
  insert into experiences (id, name, location, tagline, description, duration_minutes, capacity,
                           price_cents, min_party, max_party, private, active, sort, tenant_id)
  values ('your-first-room', 'Your first room', 'Main location',
          'Rename this room, set its price and times, then switch it on.',
          'This is an example room so your portal is not empty. Open Experiences, give it the real name, ' ||
          'price, party size and session times, then mark it active to put it on sale.',
          60, 8, 0, 2, 8, true, false, 1, v_tenant);

  insert into activity_log (id, action, detail, tenant_id)
  values (gen_random_uuid(), 'Business created', trim(p_name) || ' signed up; owner ' || trim(p_owner_name), v_tenant);

  return v_tenant;
end
$fn$;

revoke all on function public.slug_available(text) from public, anon, authenticated;
revoke all on function public.create_tenant(text, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.slug_available(text) to tenant_app;
grant execute on function public.create_tenant(text, text, text, text, text, text, jsonb, text) to tenant_app;

notify pgrst, 'reload schema';
