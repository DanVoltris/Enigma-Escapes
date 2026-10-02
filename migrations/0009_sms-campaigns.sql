-- Marketing texts to customers, and the opt-out list that outlives them.
--
-- A campaign is written once and sent to thousands of numbers over hours, so
-- the recipients are written down when it is created rather than recomputed as
-- it goes: the list can't shift under a send, a stopped campaign resumes where
-- it left off, and afterwards there is a record of exactly who was texted.
--
-- sms_optouts is deliberately its own table, not a flag on a customer: someone
-- who replies STOP must stay opted out even if they are deleted and re-added,
-- book again under a different email, or were never a customer record at all.
-- It is keyed on the last ten digits, the same way the app matches an inbound
-- text to a person, so "(204) 555-0134" and "+12045550134" are one number.

create table if not exists public.sms_optouts (
  tenant_id   uuid not null default public.current_tenant_id() references public.tenants (id),
  phone       text not null, -- last 10 digits
  created_at  timestamptz not null default now(),
  source      text,          -- "reply" (they texted STOP) or "staff"
  primary key (tenant_id, phone)
);

create table if not exists public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default public.current_tenant_id() references public.tenants (id),
  name         text not null,
  body         text not null,
  audience     jsonb not null default '{}'::jsonb, -- the filters, kept for the record
  status       text not null default 'draft',      -- draft | sending | paused | done
  created_by   text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

create table if not exists public.campaign_recipients (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default public.current_tenant_id() references public.tenants (id),
  campaign_id  uuid not null references public.campaigns (id) on delete cascade,
  phone        text not null, -- last 10 digits, as stored on the opt-out list
  name         text,
  status       text not null default 'pending',   -- pending | sent | failed | skipped
  error        text,
  sent_at      timestamptz
);

-- One row per number per campaign: a resend after a pause can't text anyone twice.
create unique index if not exists campaign_recipients_once
  on public.campaign_recipients (tenant_id, campaign_id, phone);
-- The send loop asks for the next few pending rows, over and over.
create index if not exists campaign_recipients_next
  on public.campaign_recipients (tenant_id, campaign_id, status);
create index if not exists campaigns_recent on public.campaigns (tenant_id, created_at desc);

alter table public.sms_optouts enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
grant select, insert, update, delete on public.sms_optouts to tenant_app;
grant select, insert, update, delete on public.campaigns to tenant_app;
grant select, insert, update, delete on public.campaign_recipients to tenant_app;
drop policy if exists tenant_isolation on public.sms_optouts;
create policy tenant_isolation on public.sms_optouts for all to tenant_app
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists tenant_isolation on public.campaigns;
create policy tenant_isolation on public.campaigns for all to tenant_app
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
drop policy if exists tenant_isolation on public.campaign_recipients;
create policy tenant_isolation on public.campaign_recipients for all to tenant_app
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- Who a campaign would reach, worked out in the database.
--
-- The alternative is reading every booking into the app and grouping there:
-- 29,000 rows and their JSON over the wire to count a few thousand numbers,
-- for every change to a filter. This answers in one round trip.
--
-- A number is kept once, under its last ten digits — the same key the opt-out
-- list and the inbound-text matcher use, so "(204) 555-0134" and
-- "+1 204 555 0134" are one person. Cancelled bookings still count as having
-- bought: the relationship is what consent rests on, not whether they came.
create or replace function public.campaign_audience(
  months integer,                 -- null: no limit on how long ago they booked
  include_subscribers boolean,    -- add everyone who ticked the box, any date
  area_codes text[],              -- null or empty: any area code
  locations text[]                -- null or empty: any location
) returns table (phone text, name text, last_booked date)
language sql
stable
security invoker
set search_path = public
as $$
  with booked as (
    select right(regexp_replace(b.customer->>'phone', '\D', '', 'g'), 10) as phone,
           min(b.customer->>'firstName') as name,
           max(coalesce((i->>'date')::date, b.created_at::date)) as last_booked
    from public.bookings b
    cross join lateral jsonb_array_elements(b.items) as i
    where b.tenant_id = (select public.current_tenant_id())
      and length(regexp_replace(coalesce(b.customer->>'phone', ''), '\D', '', 'g')) >= 10
      and (locations is null or cardinality(locations) = 0 or i->>'location' = any(locations))
    group by 1
  ),
  subscribers as (
    select right(regexp_replace(c.phone, '\D', '', 'g'), 10) as phone,
           c.first_name as name,
           null::date as last_booked
    from public.customers c
    where include_subscribers
      and c.subscribe
      and c.tenant_id = (select public.current_tenant_id())
      and length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 10
  ),
  everyone as (
    select phone, name, last_booked from booked
    where months is null
       or last_booked >= (current_date - make_interval(months => months))
    union all
    select phone, name, last_booked from subscribers
  )
  select e.phone, min(e.name) as name, max(e.last_booked) as last_booked
  from everyone e
  where (area_codes is null or cardinality(area_codes) = 0 or left(e.phone, 3) = any(area_codes))
    and not exists (
      select 1 from public.sms_optouts o
      where o.tenant_id = (select public.current_tenant_id()) and o.phone = e.phone
    )
  group by e.phone;
$$;

grant execute on function public.campaign_audience(integer, boolean, text[], text[]) to tenant_app;

-- Admins already have every other permission; this one is new, so it is given
-- to them rather than leaving the owner unable to open the page they asked for.
-- Managers and front desk get it ticked on per person.
update public.staff_accounts
   set permissions = permissions || '["marketing"]'::jsonb
 where role = 'admin'
   and not (permissions @> '["marketing"]'::jsonb);

notify pgrst, 'reload schema';
