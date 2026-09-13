-- Undo migrations/0003_unique-per-tenant.sql on one venue. Paste into that
-- venue's SQL editor only if 0003 has to come off — and only while the app
-- still targets the old conflict columns: once the code upserts on
-- (tenant_id, …) these indexes are what it saves against.
--
-- Drops the per-tenant unique indexes and un-records 0003. The old rules were
-- never touched, so nothing else changes. Touches no data.
begin;
drop index if exists experiences_tenant_id_key;
drop index if exists customers_tenant_email_key;
drop index if exists promo_codes_tenant_code_key;
drop index if exists gift_vouchers_tenant_code_key;
drop index if exists reward_codes_tenant_code_key;
drop index if exists taxes_tenant_id_key;
drop index if exists location_hours_tenant_location_key;
drop index if exists settings_tenant_key_key;
drop index if exists feedback_tenant_reference_key;
drop index if exists booking_email_stats_tenant_key_key;
drop index if exists bookings_tenant_reference_key;
drop index if exists staff_accounts_tenant_email_key;
drop index if exists quotes_tenant_number_key;
drop index if exists slot_blocks_tenant_slot_key;
drop index if exists booking_id_reissues_tenant_old_key;
delete from schema_migrations where version = '0003';
commit;
notify pgrst, 'reload schema';
