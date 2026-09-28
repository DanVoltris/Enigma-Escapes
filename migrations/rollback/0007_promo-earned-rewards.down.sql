alter table promo_codes drop column if exists reward_percent;
alter table promo_codes drop column if exists reward_days;
alter table reward_codes drop column if exists earned_start;
