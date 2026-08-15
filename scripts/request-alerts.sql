-- Booking request alerts, per person, on the Staff tab.
-- Run once in the Supabase SQL editor. Safe to run twice.

-- Where a staff member's alerts go, and whether they want them.
alter table staff_members add column if not exists phone text;
alter table staff_members add column if not exists request_alerts boolean not null default false;

-- Managers and admins are always texted, so their number lives on the account
-- that carries the role. No switch column: having a number IS the switch.
alter table staff_accounts add column if not exists phone text;

-- The permission that shows the list. New permissions aren't retro-granted —
-- an account's ticks are whatever was stored when it was last saved — so the
-- roles that should have it are given it here. Clerks are deliberately left out.
update staff_accounts
set permissions = permissions || '["alerts"]'::jsonb
where role in ('admin', 'manager')
  and not (permissions ? 'alerts');
