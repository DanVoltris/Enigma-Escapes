-- The Customers tab roster, computed where the data lives.
--
-- Mirrors aggregateCustomers() in lib/customers.ts exactly:
--   * live bookings only (cancelled out; pending only until it expires)
--   * grouped by lowercased email; walk-ins with no email left out
--   * legacy totals net of the sessions already itemised as imported
--     bookings (reference VB-L...), so history never counts twice
--   * newest booking wins the contact details, but only if it is newer
--     than the customer record itself
--   * optional location scope filters which bookings count, never which
--     customers exist (same as the page's in-memory filter did)
--
-- total_rows repeats the full match count on every row (window count) so one
-- call serves both the page and the "N customers" line.
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
with live as (
  select
    lower(b.customer->>'email')                                as key,
    b.customer->>'email'                                       as email,
    concat(coalesce(b.customer->>'firstName',''), ' ',
           coalesce(b.customer->>'lastName',''))               as name,
    coalesce(b.customer->>'phone','')                          as phone,
    coalesce((b.customer->>'subscribe')::boolean, false)       as subscribe,
    b.created_at,
    b.reference like 'VB-L%'                                   as is_imported_ref,
    coalesce(jsonb_array_length(b.items), 0)                   as sessions,
    coalesce((
      select sum(coalesce((i->>'quantity')::int, 0))
      from jsonb_array_elements(b.items) i
    ), 0)                                                      as guests,
    coalesce((b.pricing->>'paidCents')::bigint, 0)             as paid
  from bookings b
  where coalesce(b.customer->>'email','') <> ''
    and case coalesce(b.status, 'paid')
          when 'cancelled' then false
          when 'pending'   then b.pending_expires_at is not null
                                and b.pending_expires_at > now()
          else true
        end
    and (p_locations is null or exists (
          select 1 from jsonb_array_elements(b.items) i
          where i->>'location' = any(p_locations)))
),
agg as (
  select
    key,
    count(*)::int                                       as bookings,
    sum(guests)::int                                    as guests,
    sum(paid)::bigint                                   as spent,
    max(created_at)                                     as last_booked,
    coalesce(sum(sessions) filter (where is_imported_ref), 0)::int  as itemised_sessions,
    coalesce(sum(paid)     filter (where is_imported_ref), 0)::bigint as itemised_paid
  from live
  group by key
),
newest as (
  select distinct on (key) key, email, name, phone, subscribe, created_at
  from live
  order by key, created_at desc
),
merged as (
  select
    coalesce(lower(c.email), a.key) as key,
    case
      when c.email is not null and (n.key is null or n.created_at < c.created_at)
        then concat(c.first_name, ' ', c.last_name)
      else n.name
    end as name,
    coalesce(c.email, n.email) as email,
    case
      when c.email is not null and (n.key is null or n.created_at < c.created_at)
        then coalesce(c.phone, '')
      else n.phone
    end as phone,
    case
      when c.email is not null and (n.key is null or n.created_at < c.created_at)
        then c.subscribe is true
      else n.subscribe
    end as subscribed,
    -- what's on the roster row: live bookings here, plus whatever of the
    -- legacy totals isn't itemised as an imported booking already
    (coalesce(a.bookings, 0)
      + greatest(0, coalesce((c.imported->>'bookings')::int, 0)
                    - coalesce(a.itemised_sessions, 0)))            as bookings,
    coalesce(a.guests, 0)                                           as guests,
    (coalesce(a.spent, 0)
      + greatest(0, coalesce((c.imported->>'paidCents')::bigint, 0)
                    - coalesce(a.itemised_paid, 0)))                as spent_cents,
    greatest(coalesce(a.last_booked, c.created_at), c.created_at)   as last_booked,
    (c.imported is not null)                                        as has_imported
  from customers c
  full outer join agg a on lower(c.email) = a.key
  left join newest n on n.key = coalesce(lower(c.email), a.key)
)
select
  count(*) over ()::bigint as total_rows,
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

-- The manager portal reaches this through the service_role key only; nothing
-- public should be able to call it (the tables it reads are RLS-locked, but a
-- roster function is exactly the kind of thing that shouldn't be probeable).
revoke execute on function public.customer_roster(text, boolean, text[], int, int)
  from public, anon, authenticated;
