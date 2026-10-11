-- Drops the old "unique across the whole table" rules, leaving the per-business
-- ones migration 0003 added. This is what finally lets two businesses share a
-- room name, a promo code, a customer email or a setting in one database.
--
-- 0003 added unique (tenant_id, …) beside each old rule and the app moved its
-- saves onto them (on_conflict=tenant_id,…). Both venues and staging have run
-- that way since 2026-09-14, so the old rules are now only in the way.
--
-- Each natural-key primary key is replaced by its per-business index, promoted
-- in place: no index is built and no data is rewritten, so the tables are held
-- only for an instant. Re-running finds the index already promoted and does
-- nothing.
--
-- Deliberately left whole-table unique, because they are unique by nature and
-- must stay so across every business:
--   quotes.token                     a secret link
--   reward_codes.earned_booking      a booking's own id
--   gift_vouchers.stripe_session_id  Stripe's id
--   booking_id_reissues.new_id       a random id
--   every uuid primary key (bookings, slot_blocks, quotes, staff_accounts, …)
--
-- Two plain indexes are added at the end. Dropping these primary keys removes
-- the only index on customers.email and booking_email_stats.key, and while the
-- app always reads within one business (the policies see to that, so the
-- per-business index serves it), the import scripts run as service_role and
-- look rows up by email alone. Without these, a re-import would fall back to
-- scanning 45,000 customers a time.

do $block$
declare
  r record;
begin
  for r in
    select *
      from (values
        ('experiences',         'experiences_tenant_id_key'),
        ('customers',           'customers_tenant_email_key'),
        ('promo_codes',         'promo_codes_tenant_code_key'),
        ('gift_vouchers',       'gift_vouchers_tenant_code_key'),
        ('reward_codes',        'reward_codes_tenant_code_key'),
        ('taxes',               'taxes_tenant_id_key'),
        ('location_hours',      'location_hours_tenant_location_key'),
        ('settings',            'settings_tenant_key_key'),
        ('feedback',            'feedback_tenant_reference_key'),
        ('booking_email_stats', 'booking_email_stats_tenant_key_key'),
        ('booking_id_reissues', 'booking_id_reissues_tenant_old_key')
      ) as t(tbl, idx)
  loop
    -- Only while the per-business index is still a plain index: once promoted
    -- it carries the primary key's name instead, so a second run skips it.
    if exists (
          select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = r.idx)
       and not exists (select 1 from pg_constraint con where con.conname = r.idx)
    then
      execute format('alter table public.%I drop constraint if exists %I', r.tbl, r.tbl || '_pkey');
      execute format('alter table public.%I add constraint %I primary key using index %I',
                     r.tbl, r.tbl || '_pkey', r.idx);
    end if;
  end loop;
end
$block$;

-- The remaining whole-table rules on names a business chooses.
alter table public.staff_accounts drop constraint if exists staff_accounts_email_key;
alter table public.quotes         drop constraint if exists quotes_number_key;
alter table public.bookings       drop constraint if exists bookings_reference_key;
-- The blocked-slot rule exists as a bare index on some venues and as a
-- constraint on others, depending on how that table was first created.
alter table public.slot_blocks drop constraint if exists slot_blocks_room_id_date_time_key;
drop index if exists public.slot_blocks_unique;

-- See the note above: for the scripts that still read by the natural key alone.
create index if not exists customers_email_idx on public.customers (email);
create index if not exists booking_email_stats_key_idx on public.booking_email_stats (key);

notify pgrst, 'reload schema';
