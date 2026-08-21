-- Room training and the staff roster move out from under account administration
-- into their own permission, so managers can sign people off on rooms without
-- also being able to create logins and set roles.
--
-- Run once in the Supabase SQL editor. Safe to run twice.
--
-- New permissions are not retro-granted — an account's ticks are whatever was
-- stored when it was last saved — so the roles that should have it are given it
-- here. Clerks are deliberately left out.
update staff_accounts
set permissions = permissions || '["roster"]'::jsonb
where role in ('admin', 'manager')
  and not (permissions ? 'roster');
