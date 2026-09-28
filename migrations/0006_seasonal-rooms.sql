-- Rooms that only run for part of the year.
--
-- Enigma's Christmas rooms (St. Vital) are built in November and taken apart in
-- January; the rest of the year they must not appear on the booking site at all.
-- Until now the only way to keep a room off sale for a while was to switch it
-- off by hand and remember to switch it back.
--
-- Both dates are inclusive and either may stand alone: a "from" with no "to"
-- opens a room on a date and leaves it open, and a "to" with no "from" closes it
-- after a date. Null in both is what every existing room has — always on sale.
--
-- Two nullable columns: no rewrite, no long lock, safe while a venue is open.

alter table public.experiences add column if not exists available_from date;
alter table public.experiences add column if not exists available_to date;

notify pgrst, 'reload schema';
