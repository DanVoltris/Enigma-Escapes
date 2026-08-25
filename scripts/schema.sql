-- =============================================================================
-- Voltris Booking — complete database schema
--
-- Builds an empty Supabase/Postgres database into one this app can run against.
-- Paste the whole file into the Supabase SQL editor and run it once.
--
-- Two jobs:
--   1. Standing up a second venue on its own database (own Supabase project,
--      own Vercel project, same codebase).
--   2. Rebuilding this one. Until this file existed the schema lived in prose
--      in CLAUDE.md and in nine patch scripts, which meant a lost Supabase
--      project could not be rebuilt from the repo.
--
-- Every statement is idempotent — `if not exists` / `create or replace` — so
-- running it twice is harmless and running it against an existing database
-- brings it up to date without touching data.
--
-- The other scripts/*.sql files are the historical record of how production
-- got here, applied in order over time. THIS file is the current truth: it was
-- generated from the live database's own schema (via PostgREST's OpenAPI
-- description) on 2026-08-22, so it describes what is actually running.
--
-- Deliberately NOT included: any data. A fresh install starts empty; `/login`
-- becomes a one-time first-admin setup while `staff_accounts` has no rows.
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------- experiences
-- The rooms. Prices, capacity, session times and badge colours all live here
-- and are edited from /manager/experiences without a deploy.
create table if not exists experiences (
  id                text primary key,
  name              text not null,
  location          text not null default '',
  tagline           text not null default '',
  description       text not null default '',
  duration_minutes  int not null default 60,
  capacity          int not null default 8,
  price_cents       int not null default 0,
  min_party         int not null default 4,
  max_party         int not null default 8,
  private           boolean not null default false,
  deposit_percent   numeric not null default 25,
  schedule_mode     text not null default 'times',   -- times | interval | windows
  times             jsonb not null default '[]'::jsonb,
  interval_minutes  int not null default 75,
  windows           jsonb not null default '[]'::jsonb,
  date_times        jsonb,                            -- one-off times per date
  badge_bg          text not null default '#0B2540',
  badge_fg          text not null default '#FFFFFF',
  image_url         text,
  active            boolean not null default true,
  sort              int not null default 0
);

-- ------------------------------------------------------------------- bookings
-- reference is unique, not the key: the app upserts on it so a re-run of the
-- legacy importer updates a booking rather than duplicating it.
create table if not exists bookings (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,
  created_at          timestamptz not null default now(),
  customer            jsonb not null,
  items               jsonb not null,
  promo_code          text,
  payment_option      text not null default 'full',   -- full | deposit
  pricing             jsonb not null,
  source              text not null default 'online', -- online | walkin | imported
  no_show             boolean not null default false,
  status              text,                            -- null/paid | pending | cancelled
  pending_expires_at  timestamptz,
  game_result         jsonb,
  notes               jsonb,
  booked_by           text                             -- staff member, for desk sales
);

-- ------------------------------------------------------------------ customers
-- legacy_* are generated from the old system's import blob so the roster can
-- read two integers without detoasting the whole jsonb on every row.
create table if not exists customers (
  email       text primary key,
  first_name  text not null,
  last_name   text not null,
  phone       text,
  subscribe   boolean not null default false,
  created_at  timestamptz not null default now(),
  imported    jsonb
);
alter table customers
  add column if not exists legacy_bookings int
    generated always as (coalesce((imported->>'bookings')::int, 0)) stored,
  add column if not exists legacy_paid bigint
    generated always as (coalesce((imported->>'paidCents')::bigint, 0)) stored;

-- --------------------------------------------------------------- promo_codes
create table if not exists promo_codes (
  code         text primary key,
  percent_off  numeric not null,
  active       boolean not null default true
);

-- ------------------------------------------------------------- gift_vouchers
-- Every balance in circulation: bought by a customer (kind 'purchased') or
-- handed out by staff (kind 'comp'). stripe_session_id is unique so the webhook
-- and the return page cannot both mint the same voucher.
create table if not exists gift_vouchers (
  code              text primary key,
  face_cents        int not null,
  remaining_cents   int not null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  purchaser         text,
  email             text,
  message           text,
  last_used_at      timestamptz,
  redemption_type   text not null default 'value',    -- value | spaces
  spaces_total      int,
  spaces_left       int,
  one_time_use      boolean not null default false,
  items_scope       text not null default 'all',      -- all | some
  item_ids          text[] not null default '{}',
  date_option       text not null default 'any',
  date_from         date,
  date_to           date,
  time_option       text not null default 'any',
  time_from         text,
  time_to           text,
  days_of_week      integer[] not null default '{}',
  exclusion_dates   date[] not null default '{}',
  expiry_date       date,
  recipient_email   text,
  source            text not null default 'imported',
  kind              text not null default 'comp',     -- comp | purchased
  stripe_session_id text unique,
  spend_state       text
);

-- ----------------------------------------------------------- voucher_products
-- The catalogue: what customers can buy on /gift-vouchers.
create table if not exists voucher_products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  amount_cents  int not null,
  description   text,
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- -------------------------------------------------------------- reward_codes
-- One per booking, so earned_booking is unique.
create table if not exists reward_codes (
  code            text primary key,
  percent_off     int not null default 20,
  earned_booking  uuid not null unique,
  customer_phone  text not null,
  valid_until     timestamptz not null,
  used_booking    uuid,
  used_at         timestamptz,
  revoked_at      timestamptz,
  status          text not null default 'active',
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------- booking_requests
-- Sessions starting within the request window are not self-serve: the site
-- collects a request and staff accept or decline it.
create table if not exists booking_requests (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  room_id      text not null,
  room_name    text not null,
  location     text not null,
  date         text not null,
  time         text not null,
  quantity     int not null,
  first_name   text not null,
  last_name    text not null default '',
  phone        text not null,
  email        text,
  status       text not null default 'pending',
  token        text not null,
  decided_at   timestamptz,
  booking_id   uuid,
  reminded_at  timestamptz
);

-- ----------------------------------------------------------------- slot_blocks
-- Sessions taken out of service. Unique per room/date/time so the same slot
-- cannot be blocked twice.
create table if not exists slot_blocks (
  id          uuid primary key default gen_random_uuid(),
  room_id     text not null,
  date        text not null,
  time        text not null,
  reason      text,
  created_at  timestamptz not null default now(),
  blocked_by  text,
  unique (room_id, date, time)
);

-- ---------------------------------------------------------------------- taxes
create table if not exists taxes (
  id       text primary key,
  name     text not null,
  percent  numeric not null,
  active   boolean not null default true,
  sort     int not null default 0
);

-- ------------------------------------------------------------- location_hours
create table if not exists location_hours (
  location  text primary key,
  hours     jsonb not null default '{}'::jsonb
);

-- ------------------------------------------------------------------- settings
-- Key/value for everything configured in the portal: business_details,
-- booking_site, integrations, checklists, partner_api_keys and the rest.
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------- staff_accounts
-- Portal logins. scrypt password hashes; roles are presets over the individual
-- permissions in the jsonb.
create table if not exists staff_accounts (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  name           text not null,
  password_hash  text not null,
  role           text not null default 'clerk',      -- admin | manager | clerk
  locations      jsonb not null default '[]'::jsonb, -- empty = all locations
  permissions    jsonb not null default '[]'::jsonb,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz,
  phone          text
);

-- ------------------------------------------------------------- staff_sessions
-- Cookie tokens, stored as SHA-256 so a database leak is not a set of live
-- sessions. Revocable by deleting the row.
create table if not exists staff_sessions (
  token_hash  text primary key,
  staff_id    uuid not null references staff_accounts(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists staff_sessions_staff_idx on staff_sessions (staff_id);

-- -------------------------------------------------------------- staff_members
-- The shift roster — who works here, which rooms they can run. Separate from
-- staff_accounts: not everyone on the roster has a portal login.
create table if not exists staff_members (
  id              text primary key,
  name            text not null,
  home_location   text,
  trained_rooms   jsonb not null default '[]'::jsonb,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  phone           text,
  request_alerts  boolean not null default false
);

create table if not exists staff_shifts (
  id           uuid primary key default gen_random_uuid(),
  member_id    text not null references staff_members(id) on delete cascade,
  member_name  text not null,
  location     text,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index if not exists staff_shifts_member_idx on staff_shifts (member_id, started_at desc);

create table if not exists staff_notes (
  id          uuid primary key default gen_random_uuid(),
  note        text not null,
  created_at  timestamptz not null default now()
);

-- --------------------------------------------------------------- activity_log
create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,
  detail      text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists activity_log_created_idx on activity_log (created_at desc);

-- ------------------------------------------------------------------- feedback
-- Post-game survey, one response per booking reference.
create table if not exists feedback (
  reference   text primary key,
  rating      int not null,
  comment     text,
  name        text,
  created_at  timestamptz not null default now()
);

-- =============================================================================
-- Derived tables, indexes and functions
--
-- These are what keep the portal quick at 29k bookings / 45k customers: the
-- aggregation happens in the database, so a page view reads a few hundred rows
-- instead of re-summing the whole table.
-- =============================================================================

-- Per-customer booking aggregates, kept current by a trigger on bookings.
create table if not exists booking_email_stats (
  key                text primary key,   -- lowercased email
  email              text not null,      -- as stored on the newest booking
  name               text not null,
  phone              text not null,
  subscribe          boolean not null,
  booked_at          timestamptz not null,
  bookings           int not null,
  guests             int not null,
  spent              bigint not null,
  itemised_sessions  int not null,       -- share coming from imported (VB-L) refs
  itemised_paid      bigint not null,
  last_booked        timestamptz not null
);

create index if not exists bookings_customer_email_idx
  on bookings (lower(customer->>'email'));
create index if not exists bookings_created_at_id_idx
  on bookings (created_at desc, id desc);

------------------------------------------------------------------- window read
-- Dashboard and Reports fetch a date window, not the world.
create or replace function public.bookings_in_window(p_from date, p_to date)
returns setof bookings
language sql
stable
as $$
  select *
  from bookings b
  where (b.created_at >= p_from::timestamptz
         and b.created_at < (p_to + 1)::timestamptz)
     or exists (
          select 1 from jsonb_array_elements(b.items) i
          where i->>'date' >= p_from::text
            and i->>'date' <= p_to::text)
$$;
revoke execute on function public.bookings_in_window(date, date)
  from public, anon, authenticated;

--------------------------------------------------------------- customer stats
-- Recompute one email's row from its live bookings. Live means: not cancelled,
-- and pending only until it expires — same rule as lib/db.ts isLiveBooking.
create or replace function public.refresh_booking_email_stats(p_key text)
returns void
language sql
as $$
  delete from booking_email_stats where key = p_key;
  insert into booking_email_stats
  select
    p_key,
    (array_agg(b.customer->>'email' order by b.created_at desc, b.id desc))[1],
    (array_agg(concat(coalesce(b.customer->>'firstName',''), ' ',
                      coalesce(b.customer->>'lastName',''))
               order by b.created_at desc, b.id desc))[1],
    (array_agg(coalesce(b.customer->>'phone','') order by b.created_at desc, b.id desc))[1],
    (array_agg(coalesce((b.customer->>'subscribe')::boolean, false)
               order by b.created_at desc, b.id desc))[1],
    max(b.created_at),
    count(*)::int,
    coalesce(sum((select sum(coalesce((i->>'quantity')::int, 0))
                  from jsonb_array_elements(b.items) i)), 0)::int,
    coalesce(sum(coalesce((b.pricing->>'paidCents')::bigint, 0)), 0),
    coalesce(sum(jsonb_array_length(b.items)) filter (where b.reference like 'VB-L%'), 0)::int,
    coalesce(sum(coalesce((b.pricing->>'paidCents')::bigint, 0))
               filter (where b.reference like 'VB-L%'), 0),
    max(b.created_at)
  from bookings b
  where lower(b.customer->>'email') = p_key
    and coalesce(b.customer->>'email','') <> ''
    and case coalesce(b.status, 'paid')
          when 'cancelled' then false
          when 'pending'   then b.pending_expires_at is not null
                                and b.pending_expires_at > now()
          else true
        end
  having count(*) > 0
$$;

create or replace function public.booking_email_stats_sync()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and coalesce(old.customer->>'email','') <> '' then
    perform refresh_booking_email_stats(lower(old.customer->>'email'));
  end if;
  if tg_op in ('INSERT', 'UPDATE') and coalesce(new.customer->>'email','') <> '' then
    perform refresh_booking_email_stats(lower(new.customer->>'email'));
  end if;
  return null;
end;
$$;

drop trigger if exists booking_email_stats_trg on bookings;
create trigger booking_email_stats_trg
  after insert or update or delete on bookings
  for each row execute function public.booking_email_stats_sync();

------------------------------------------------------------------ the rosters
-- Customers tab: customers x stats, merged so the old system's per-customer
-- totals are not counted twice against sessions since itemised as bookings.
create or replace function public.customer_roster(
  p_q text default null,
  p_subscribers_only boolean default false,
  p_locations text[] default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  total_rows bigint,
  name text,
  email text,
  phone text,
  subscribed boolean,
  bookings int,
  guests int,
  spent_cents bigint,
  last_booked timestamptz,
  has_imported boolean
)
language sql
stable
as $$
with agg as (
  -- Location scope is the rare case; the common call joins the stats table as
  -- is. Scoped staff re-aggregate live (few hundred rows per location window).
  select s.key, s.email, s.name, s.phone, s.subscribe, s.booked_at,
         s.bookings, s.guests, s.spent, s.itemised_sessions, s.itemised_paid, s.last_booked
  from booking_email_stats s
  where p_locations is null
  union all
  select
    lower(b.customer->>'email'),
    (array_agg(b.customer->>'email' order by b.created_at desc, b.id desc))[1],
    (array_agg(concat(coalesce(b.customer->>'firstName',''), ' ',
                      coalesce(b.customer->>'lastName','')) order by b.created_at desc, b.id desc))[1],
    (array_agg(coalesce(b.customer->>'phone','') order by b.created_at desc, b.id desc))[1],
    (array_agg(coalesce((b.customer->>'subscribe')::boolean,false) order by b.created_at desc, b.id desc))[1],
    max(b.created_at),
    count(*)::int,
    coalesce(sum((select sum(coalesce((i->>'quantity')::int,0)) from jsonb_array_elements(b.items) i)),0)::int,
    coalesce(sum(coalesce((b.pricing->>'paidCents')::bigint,0)),0),
    coalesce(sum(jsonb_array_length(b.items)) filter (where b.reference like 'VB-L%'),0)::int,
    coalesce(sum(coalesce((b.pricing->>'paidCents')::bigint,0)) filter (where b.reference like 'VB-L%'),0),
    max(b.created_at)
  from bookings b
  where p_locations is not null
    and coalesce(b.customer->>'email','') <> ''
    and case coalesce(b.status,'paid')
          when 'cancelled' then false
          when 'pending' then b.pending_expires_at is not null and b.pending_expires_at > now()
          else true end
    and exists (select 1 from jsonb_array_elements(b.items) i
                where i->>'location' = any(p_locations))
  group by lower(b.customer->>'email')
),
merged as (
  select
    case
      when c.email is not null and (a.key is null or a.booked_at < c.created_at)
        then concat(c.first_name, ' ', c.last_name)
      else a.name
    end as name,
    coalesce(c.email, a.email) as email,
    case
      when c.email is not null and (a.key is null or a.booked_at < c.created_at)
        then coalesce(c.phone, '')
      else a.phone
    end as phone,
    case
      when c.email is not null and (a.key is null or a.booked_at < c.created_at)
        then c.subscribe is true
      else a.subscribe
    end as subscribed,
    (coalesce(a.bookings, 0)
      + greatest(0, coalesce(c.legacy_bookings, 0) - coalesce(a.itemised_sessions, 0))) as bookings,
    coalesce(a.guests, 0) as guests,
    (coalesce(a.spent, 0)
      + greatest(0, coalesce(c.legacy_paid, 0) - coalesce(a.itemised_paid, 0))) as spent_cents,
    greatest(coalesce(a.last_booked, c.created_at), c.created_at) as last_booked,
    (c.imported is not null) as has_imported
  from customers c
  full outer join agg a on lower(c.email) = a.key
)
select
  count(*) over ()::bigint,
  m.name, m.email, m.phone, m.subscribed,
  m.bookings, m.guests, m.spent_cents, m.last_booked, m.has_imported
from merged m
where (p_q is null or p_q = ''
       or (m.name || ' ' || m.email || ' ' || m.phone) ilike ('%' || p_q || '%'))
  and (not p_subscribers_only or m.subscribed)
order by m.last_booked desc, m.email asc
limit greatest(p_limit, 0)
offset greatest(p_offset, 0)
$$;
revoke execute on function public.customer_roster(text, boolean, text[], int, int)
  from public, anon, authenticated;

-- Bookings tab: search/filter/sort/page in the database, so "All time" returns
-- 200 rows instead of 29,000.
create or replace function public.bookings_roster(
  p_q text default null,
  p_status text default 'all',          -- all | active | noshow
  p_pay text default 'all',             -- all | paid | unpaid
  p_date text default null,             -- session date, exact
  p_tz text default 'America/Winnipeg', -- venue timezone for business dates
  p_from_day date default null,         -- purchase window, venue-local days
  p_to_day date default null,
  p_since timestamptz default null,     -- rolling cutoff (the "24h" view)
  p_locations text[] default null,
  p_limit int default 200,
  p_offset int default 0
)
returns table (total_rows bigint, booking jsonb)
language sql
stable
as $$
  with hit as (
    select b.*
    from bookings b
    where
      -- same live/cancelled rule the list screen shows (cancelled stay listed)
      (case coalesce(b.status, 'paid')
         when 'cancelled' then true
         when 'pending'   then b.pending_expires_at is not null
                               and b.pending_expires_at > now()
         else true
       end)
      and (p_since is null or b.created_at >= p_since)
      and (p_from_day is null or (b.created_at at time zone p_tz)::date >= p_from_day)
      and (p_to_day   is null or (b.created_at at time zone p_tz)::date <= p_to_day)
      and (p_date is null or exists (
             select 1 from jsonb_array_elements(b.items) i where i->>'date' = p_date))
      and (p_locations is null or exists (
             select 1 from jsonb_array_elements(b.items) i
             where i->>'location' = any(p_locations)))
      and (p_status <> 'active' or b.no_show is not true)
      and (p_status <> 'noshow' or b.no_show is true)
      and (p_pay <> 'paid'   or coalesce((b.pricing->>'balanceCents')::bigint, 0) <= 0)
      and (p_pay <> 'unpaid' or coalesce((b.pricing->>'balanceCents')::bigint, 0) > 0)
      and (p_q is null or p_q = ''
           or concat_ws(' ',
                b.reference,
                b.customer->>'firstName', b.customer->>'lastName',
                b.customer->>'email', b.customer->>'phone') ilike ('%' || p_q || '%')
           or exists (
                select 1 from jsonb_array_elements(b.items) i
                where i->>'roomName' ilike ('%' || p_q || '%')))
  )
  select count(*) over ()::bigint, to_jsonb(hit.*)
  from hit
  order by created_at desc, id desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0)
$$;
revoke execute on function public.bookings_roster(text, text, text, text, text, date, date, timestamptz, text[], int, int)
  from public, anon, authenticated;

--------------------------------------------------------------- voucher totals
-- These two were live in production but their source was in no script — they
-- are reconstructed here and checked against the live database's own output
-- over all 2,117 vouchers (see the commit message).
--
-- Note `outstanding` counts ACTIVE vouchers only. A deactivated voucher may
-- still show a remaining balance in its row, but it cannot be spent, so it is
-- not money the business owes anyone.
create or replace function public.voucher_totals()
returns json
language sql
stable
as $$
  select json_build_object(
    'total',       count(*),
    'face',        coalesce(sum(face_cents), 0),
    'outstanding', coalesce(sum(remaining_cents) filter (where active), 0),
    'live',        count(*) filter (where active and remaining_cents > 0)
  )
  from gift_vouchers
$$;
revoke execute on function public.voucher_totals() from public, anon, authenticated;

-- Per-denomination sales figures for the catalogue. Counts every voucher ever
-- issued at that face value, active or not — this is a sales history, not a
-- liability figure.
create or replace function public.voucher_product_stats()
returns table (face_cents int, issued bigint, spent bigint, value_cents bigint)
language sql
stable
as $$
  select
    v.face_cents,
    count(*)                                            as issued,
    count(*) filter (where v.remaining_cents <= 0)      as spent,
    coalesce(sum(v.face_cents), 0)::bigint              as value_cents
  from gift_vouchers v
  group by v.face_cents
$$;
revoke execute on function public.voucher_product_stats() from public, anon, authenticated;

-- =============================================================================
-- Row level security
--
-- Every table on, with no policies: the public anon key can touch nothing. All
-- access goes through the service_role key in server code (lib/supabase.ts),
-- which bypasses RLS. This is the app's entire data security boundary — if a
-- table is added later, it must be added here too.
--
-- (Production also carries an `rls_auto_enable()` function that predates this
-- file and whose source is not in the repo. The explicit statements below do
-- the same job for a fresh database, so it is not needed here.)
-- =============================================================================
alter table experiences         enable row level security;
alter table bookings            enable row level security;
alter table customers           enable row level security;
alter table promo_codes         enable row level security;
alter table gift_vouchers       enable row level security;
alter table voucher_products    enable row level security;
alter table reward_codes        enable row level security;
alter table booking_requests    enable row level security;
alter table slot_blocks         enable row level security;
alter table taxes               enable row level security;
alter table location_hours      enable row level security;
alter table settings            enable row level security;
alter table staff_accounts      enable row level security;
alter table staff_sessions      enable row level security;
alter table staff_members       enable row level security;
alter table staff_shifts        enable row level security;
alter table staff_notes         enable row level security;
alter table activity_log        enable row level security;
alter table feedback            enable row level security;
alter table booking_email_stats enable row level security;

-- =============================================================================
-- Check it worked. Expect 20 tables and 7 functions.
-- =============================================================================
select 'tables' as kind, count(*) as found, 20 as expected
from pg_tables where schemaname = 'public'
union all
select 'functions', count(*), 7
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('bookings_in_window','refresh_booking_email_stats',
                    'booking_email_stats_sync','customer_roster','bookings_roster',
                    'voucher_totals','voucher_product_stats')
union all
select 'tables without RLS (must be 0)', count(*), 0
from pg_tables t where t.schemaname = 'public'
  and not exists (select 1 from pg_class c
                  join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = t.tablename and c.relrowsecurity);
