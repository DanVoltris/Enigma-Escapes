-- Record which staff account took a booking, so Reports -> Sales can break
-- desk bookings down by staff. Only ever set for bookings made in the portal;
-- a customer booking themselves has nobody to credit.
--
-- Run once in the Supabase SQL editor. Safe to run twice.

alter table bookings add column if not exists booked_by text;
