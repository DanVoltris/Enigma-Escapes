-- One-off start times: a slot run on a particular date without changing what
-- that weekday does every week.
-- Run once in the Supabase SQL editor. Safe to run twice.

alter table experiences add column if not exists date_times jsonb;

-- Shape is { "YYYY-MM-DD": ["HH:MM", ...] }, and it REPLACES the room's normal
-- schedule for that date. To run Blackbeard's Brig on a different timetable on
-- 16 Aug 2026 only (list the whole day, not just the difference):
--
--   update experiences
--   set date_times = coalesce(date_times, '{}'::jsonb) || '{"2026-08-16": ["16:30"]}'::jsonb
--   where id = 'blackbeards-brig';
--
-- and to take it away again:
--
--   update experiences set date_times = date_times - '2026-08-16'
--   where id = 'blackbeards-brig';
