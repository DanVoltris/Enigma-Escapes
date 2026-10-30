-- One home for a room's dated times.
--
-- A day's own list used to live in date_times ("Times for one day") and a
-- stretch of dates in time_periods (0017) — two lists on the room page doing
-- one job. Each date_times entry becomes a one-day period, which sits inside any
-- longer stretch and wins there, exactly as it did before; date_times is then
-- emptied. The code still reads date_times, so a venue that hasn't had this yet
-- runs the same timetable either way.
update public.experiences e
set time_periods = coalesce(e.time_periods, '[]'::jsonb) || (
      select coalesce(jsonb_agg(jsonb_build_object('from', d.key, 'to', d.key, 'times', d.value) order by d.key), '[]'::jsonb)
      from jsonb_each(e.date_times) d
      where jsonb_typeof(d.value) = 'array' and jsonb_array_length(d.value) > 0
        -- a day already listed as its own period keeps that entry
        and not exists (
          select 1 from jsonb_array_elements(coalesce(e.time_periods, '[]'::jsonb)) p
          where p ->> 'from' = d.key and p ->> 'to' = d.key
        )
    ),
    date_times = '{}'::jsonb
where e.date_times is not null and jsonb_typeof(e.date_times) = 'object' and e.date_times <> '{}'::jsonb;
