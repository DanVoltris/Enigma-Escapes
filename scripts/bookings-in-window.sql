-- Bookings relevant to a date window: any session inside it, or the booking
-- itself made inside it (dashboards count "new bookings today" by purchase
-- date). Session dates live inside the items jsonb, which a plain PostgREST
-- filter can't reach — that's why the Reports tab died once six years of
-- imported history landed: it had no way to ask for less than everything.
--
-- Callers pass a day of slack on each side and keep doing their exact
-- venue-local date filtering in code, same as before.
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

-- Service-role only, like customer_roster.
revoke execute on function public.bookings_in_window(date, date)
  from public, anon, authenticated;
