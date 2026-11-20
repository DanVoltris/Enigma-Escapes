-- Dates on a promo code, two kinds, both optional and inclusive (venue days).
--
-- use_from / use_until: when the code can be typed in — a Black Friday sale
-- taken Nov 27–29, for a game whenever.
-- play_from / play_until: which games it discounts — only sessions played on
-- those days, like room_ids (0019) limits it to some rooms. On a booking that
-- mixes dates only those sessions come off; a booking with none is refused.
--
-- Null = open on that side, which is what every code made before this did.
alter table promo_codes add column if not exists use_from date;
alter table promo_codes add column if not exists use_until date;
alter table promo_codes add column if not exists play_from date;
alter table promo_codes add column if not exists play_until date;

notify pgrst, 'reload schema';
