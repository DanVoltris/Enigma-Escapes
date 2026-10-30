-- Temporary times: a room's start times for a stretch of dates, instead of its
-- usual ones — holiday hours, a summer timetable — that end by themselves.
--
-- A list of { from, to, times } (dates inclusive, times HH:MM), edited on the
-- room's page and read by startTimesFor (lib/schedule.ts): a date's own list in
-- date_times beats it, and it beats the usual schedule. Null or empty = none.
alter table public.experiences add column if not exists time_periods jsonb;

notify pgrst, 'reload schema';
