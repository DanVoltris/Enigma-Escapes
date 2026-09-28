-- A promo code can hand the customer a follow-up code: "book with YOHOHO10 and
-- your confirmation text carries 20% off, good for a week". Before this, every
-- booking earned the same 20% code and it died when that booking's session
-- started, so it could only ever be spent BEFORE the visit it was earned on.
--
-- reward_percent = 0 (the default) means the code grants nothing, which is what
-- every existing promo code does.
alter table promo_codes
  add column if not exists reward_percent int not null default 0,
  add column if not exists reward_days    int not null default 0;

-- The session that earned the reward. It used to be read off valid_until,
-- because the two were the same instant; with a reward that outlives the visit
-- they are different questions: "has it expired?" and "is this a LATER session
-- than the one that earned it?". Existing rows fall back to valid_until, which
-- for them is the same moment.
alter table reward_codes
  add column if not exists earned_start timestamptz;
