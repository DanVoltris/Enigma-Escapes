-- Makes the portal rapid at 29k bookings / 45k customers. One paste, five parts.
-- Everything is additive; the app falls back gracefully if any of it is absent.
--
--   1. bookings_in_window  — dashboard/Reports fetch a date window, not the world
--   2. legacy_* generated columns — the two numbers the roster needs out of the
--      big imported jsonb, materialised so reads never detoast it (the ALTER
--      also rewrites the table compactly, clearing tonight's update bloat)
--   3. booking_email_stats — per-customer booking aggregates, kept current by a
--      trigger on bookings; nothing re-aggregates 29k rows per page view again
--   4. customer_roster v2  — same name, same shape, now a plain join of
--      customers × stats (was: full re-aggregation per call)
--   5. bookings_roster     — search/filter/sort/page the Bookings tab in the
--      database, so "All time" returns 200 rows instead of 29,000

------------------------------------------------------------------- 1
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

------------------------------------------------------------------- 2
alter table customers
  add column if not exists legacy_bookings int
    generated always as (coalesce((imported->>'bookings')::int, 0)) stored,
  add column if not exists legacy_paid bigint
    generated always as (coalesce((imported->>'paidCents')::bigint, 0)) stored;

------------------------------------------------------------------- 3
create table if not exists booking_email_stats (
  key text primary key,                -- lowercased email
  email text not null,                 -- as stored on the newest booking
  name text not null,
  phone text not null,
  subscribe boolean not null,
  booked_at timestamptz not null,      -- newest booking's created_at
  bookings int not null,
  guests int not null,
  spent bigint not null,
  itemised_sessions int not null,      -- share coming from imported (VB-L) refs
  itemised_paid bigint not null,
  last_booked timestamptz not null
);
alter table booking_email_stats enable row level security;

create index if not exists bookings_customer_email_idx
  on bookings (lower(customer->>'email'));

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

-- Backfill every email that has bookings today.
select refresh_booking_email_stats(k)
from (select distinct lower(customer->>'email') as k
      from bookings where coalesce(customer->>'email','') <> '') keys;

------------------------------------------------------------------- 4
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

------------------------------------------------------------------- 5
create index if not exists bookings_created_at_id_idx
  on bookings (created_at desc, id desc);

create or replace function public.bookings_roster(
  p_q text default null,
  p_status text default 'all',        -- all | active | noshow
  p_pay text default 'all',           -- all | paid | unpaid
  p_date text default null,           -- session date, exact
  p_tz text default 'America/Winnipeg', -- venue timezone for business dates
  p_from_day date default null,       -- purchase window, venue-local days
  p_to_day date default null,
  p_since timestamptz default null,   -- rolling cutoff (the "24h" view)
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
