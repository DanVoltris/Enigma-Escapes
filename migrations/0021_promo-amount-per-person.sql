-- A dollar promo code can be per person: $5 off each person charged for, not
-- $5 off the booking once. Only means anything on a dollar code
-- (amount_off_cents, 0020); false = once per booking, which is every dollar
-- code made before this.
alter table promo_codes add column if not exists amount_per_person boolean not null default false;

notify pgrst, 'reload schema';
