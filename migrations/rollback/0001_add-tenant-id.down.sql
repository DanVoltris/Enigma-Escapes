-- Undo migrations/0001_add-tenant-id.sql on one venue. Paste into that venue's
-- SQL editor only if 0001 has to come off. Removes the tenant_id columns, the
-- current_tenant_id() function and the tenants table, and un-records 0001 so
-- the runner would apply it again. Touches no booking, customer or setting.
begin;
do $block$
declare t text;
begin
  foreach t in array array[
    'experiences','bookings','customers','promo_codes','gift_vouchers','voucher_products','reward_codes',
    'booking_requests','slot_blocks','taxes','location_hours','settings','staff_accounts','staff_sessions',
    'staff_members','staff_shifts','staff_notes','activity_log','feedback','quotes','site_events','booking_email_stats'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I drop column if exists tenant_id', t);
    end if;
  end loop;
end
$block$;
drop function if exists public.current_tenant_id();
drop table if exists public.tenants;
delete from schema_migrations where version = '0001';
commit;
notify pgrst, 'reload schema';
