-- Drops temporary times. Every room goes back to its usual schedule on every
-- date; one-off date lists (date_times) are untouched.
alter table public.experiences drop column if exists time_periods;
delete from schema_migrations where version = '0017';
notify pgrst, 'reload schema';
