-- Undo migrations/0013_drop-whole-table-rules.sql on one venue: puts the old
-- whole-table rules back and returns the per-business ones to plain indexes,
-- the state migration 0003 left behind.
--
-- Only possible while this database holds ONE business. Two businesses may each
-- have a WELCOME10, and no whole-table rule can be true of both at once, so
-- this refuses rather than failing half way through.
--
-- One block, no explicit transaction: a block is all-or-nothing by itself, so
-- a refusal changes nothing AND leaves no half-open transaction behind for
-- whatever is typed next in the SQL editor.

do $block$
declare
  r record;
  businesses int;
begin
  select count(*) into businesses from public.tenants;
  if businesses > 1 then
    raise exception 'This database holds % businesses. The old whole-table rules cannot be restored: two businesses may each have the same promo code, room id or customer email. Nothing was changed.', businesses;
  end if;

  for r in
    select *
      from (values
        ('experiences',         'experiences_tenant_id_key',          'id'),
        ('customers',           'customers_tenant_email_key',         'email'),
        ('promo_codes',         'promo_codes_tenant_code_key',        'code'),
        ('gift_vouchers',       'gift_vouchers_tenant_code_key',      'code'),
        ('reward_codes',        'reward_codes_tenant_code_key',       'code'),
        ('taxes',               'taxes_tenant_id_key',                'id'),
        ('location_hours',      'location_hours_tenant_location_key', 'location'),
        ('settings',            'settings_tenant_key_key',            'key'),
        ('feedback',            'feedback_tenant_reference_key',      'reference'),
        ('booking_email_stats', 'booking_email_stats_tenant_key_key', 'key'),
        ('booking_id_reissues', 'booking_id_reissues_tenant_old_key', 'old_id')
      ) as t(tbl, idx, col)
  loop
    -- Only where 0013 actually ran: the per-business index now carries the
    -- primary key's name, and the plain index of that name is gone.
    if exists (select 1 from pg_constraint con where con.conname = r.tbl || '_pkey')
       and not exists (
         select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = r.idx)
    then
      execute format('alter table public.%I drop constraint %I', r.tbl, r.tbl || '_pkey');
      execute format('alter table public.%I add primary key (%I)', r.tbl, r.col);
      execute format('create unique index if not exists %I on public.%I (tenant_id, %I)', r.idx, r.tbl, r.col);
    end if;
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'staff_accounts_email_key') then
    alter table public.staff_accounts add constraint staff_accounts_email_key unique (email);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_number_key') then
    alter table public.quotes add constraint quotes_number_key unique (number);
  end if;
  create unique index if not exists slot_blocks_unique on public.slot_blocks (room_id, date, "time");

  drop index if exists public.customers_email_idx;
  drop index if exists public.booking_email_stats_key_idx;
end
$block$;

notify pgrst, 'reload schema';
