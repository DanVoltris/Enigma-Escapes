-- A promo code worth a dollar amount off the whole booking ($20 off), not a
-- percentage. amount_off_cents set = a dollar code (percent_off is stored as
-- 0 for those); null = a percentage code, which is every code before this.
--
-- The amount comes off before tax, the way a percentage does, and never takes
-- a booking below zero (lib/pricing.ts, computeTotals).
alter table promo_codes add column if not exists amount_off_cents integer
  check (amount_off_cents is null or amount_off_cents > 0);

notify pgrst, 'reload schema';
