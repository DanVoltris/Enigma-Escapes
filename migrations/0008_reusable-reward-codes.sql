-- A reward code that can be spent more than once, until it expires. The hotel
-- offer: book with the hotel's promo code and the 20% that comes back works on
-- every game for the rest of the week, not just the next one.
--
-- The house code every booking earns is untouched: one use, and it has to be
-- spent before the visit that earned it.
alter table promo_codes
  add column if not exists reward_multi_use boolean not null default false;

alter table reward_codes
  add column if not exists multi_use boolean not null default false;
