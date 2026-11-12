-- A promo code that only works on some rooms.
--
-- Enigma brought School of Sorcery back and made WELCOMEBACKSOS for it; without
-- this the code took its percentage off whatever room it was typed against.
-- room_ids lists the experiences it discounts — empty means every room, which
-- is what every code written before this column existed already did.
--
-- On a booking that mixes rooms, only the listed rooms' sessions are
-- discounted, and the corporate fee isn't (lib/pricing.ts, computeTotals). A
-- booking with none of them is refused the code.
alter table promo_codes add column if not exists room_ids text[] not null default '{}';

notify pgrst, 'reload schema';
