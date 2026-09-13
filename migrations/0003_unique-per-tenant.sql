-- Adds "unique within a business" alongside every "unique across the whole
-- database" rule on a name people choose or an id derived from one. It changes
-- no behaviour yet.
--
-- Today each database holds one business, so a promo code, a room id or a
-- customer email only has to be unique across the table. In one shared database
-- every venue wants a WELCOME10, Enigma and Time Zone both have a
-- blackbeards-brig, and one person books at two venues. Those have to become
-- unique per tenant instead.
--
-- This is the expand half of that change. The old rules stay: the app's upserts
-- name them as conflict targets (on_conflict=code and so on), so removing one
-- before the code has moved would break saving. The order is:
--   0003 (this)  add unique (tenant_id, …) beside each old rule
--   code         every upsert targets tenant_id plus its column
--   later        once every venue runs that code, drop the old rules
-- With one tenant per database the new indexes can never disagree with the old
-- ones, so none of this can fail on existing data.
--
-- Deliberately left global, because they are unique by nature, not by choice:
-- uuid primary keys, quotes.token (a secret link), gift_vouchers.stripe_session_id
-- (Stripe's id), reward_codes.earned_booking (a booking uuid), staff_sessions
-- token hashes, staff_members ids (random), booking_id_reissues.new_id (random).
-- booking_id_reissues.old_id is here because old ids were derived from
-- transaction numbers the two venues share.
--
-- Building a unique index blocks writes to that table (not reads) until the
-- migration commits, and customers, bookings and booking_email_stats are large
-- on Enigma — so this runs there while it is closed.

create unique index if not exists experiences_tenant_id_key          on experiences (tenant_id, id);
create unique index if not exists customers_tenant_email_key         on customers (tenant_id, email);
create unique index if not exists promo_codes_tenant_code_key        on promo_codes (tenant_id, code);
create unique index if not exists gift_vouchers_tenant_code_key      on gift_vouchers (tenant_id, code);
create unique index if not exists reward_codes_tenant_code_key       on reward_codes (tenant_id, code);
create unique index if not exists taxes_tenant_id_key                on taxes (tenant_id, id);
create unique index if not exists location_hours_tenant_location_key on location_hours (tenant_id, location);
create unique index if not exists settings_tenant_key_key            on settings (tenant_id, key);
create unique index if not exists feedback_tenant_reference_key      on feedback (tenant_id, reference);
create unique index if not exists booking_email_stats_tenant_key_key on booking_email_stats (tenant_id, key);
create unique index if not exists bookings_tenant_reference_key      on bookings (tenant_id, reference);
create unique index if not exists staff_accounts_tenant_email_key    on staff_accounts (tenant_id, email);
create unique index if not exists quotes_tenant_number_key           on quotes (tenant_id, number);
create unique index if not exists slot_blocks_tenant_slot_key        on slot_blocks (tenant_id, room_id, date, time);
create unique index if not exists booking_id_reissues_tenant_old_key on booking_id_reissues (tenant_id, old_id);

notify pgrst, 'reload schema';
