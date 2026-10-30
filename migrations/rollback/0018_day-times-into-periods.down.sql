-- Moves one-day periods back into date_times. Longer stretches stay in
-- time_periods, which is where 0017 put them.
update public.experiences e
set date_times = coalesce(e.date_times, '{}'::jsonb) || (
      select coalesce(jsonb_object_agg(p ->> 'from', p -> 'times'), '{}'::jsonb)
      from jsonb_array_elements(e.time_periods) p
      where p ->> 'from' = p ->> 'to'
    ),
    time_periods = (
      select coalesce(jsonb_agg(p), '[]'::jsonb)
      from jsonb_array_elements(e.time_periods) p
      where p ->> 'from' <> p ->> 'to'
    )
where e.time_periods is not null and jsonb_typeof(e.time_periods) = 'array';
delete from schema_migrations where version = '0018';
