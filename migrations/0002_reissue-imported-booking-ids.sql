-- Gives every imported booking a random id in place of the one derived from
-- its old transaction number.
--
-- A booking's id is the only secret on its public pages (/booking/<id>,
-- /confirmation/<id>, /receipt/<id>) and the key to cancelling or moving it.
-- The importer derived imported bookings' ids from a formula that sits in a
-- public repository, fed with small sequential transaction numbers, so every
-- one could be rebuilt from its reference. lib/legacy-booking-id.ts has kept
-- those pages closed since; once this has run, nothing matches that check and
-- the pages open again for their customers. It also untangles the 134 ids that
-- Enigma and Time Zone share, since both venues' old system numbered
-- transactions from the same start — which would collide in one database.
--
-- What moves with a booking's id: reward_codes.earned_booking and
-- used_booking, booking_requests.booking_id, and any id held inside a setting
-- (the premiere draw kept winners that way). Nothing else stores one; Stripe
-- Terminal is sent a booking id in metadata but never reads it back. Links
-- already sent for an imported booking stop working — they were the guessable
-- secret, so they can't be kept.
--
-- Which bookings: reference VB-L… (only the importer mints those) whose id is
-- still version 5 — the importer's derived form. A random id is version 4, so
-- a booking that has been re-issued can never be picked again, which is what
-- makes a second run a no-op.
--
-- The customer-stats trigger is paused for the swap. Changing an id changes
-- no one's stats, and left on it would recompute a customer's totals once per
-- row — tens of thousands of times on Enigma — while holding the table.
-- Pausing it takes a lock that blocks writes to bookings (reads carry on)
-- until the migration commits; that is why this runs on a live venue while it
-- is closed.
--
-- booking_id_reissues keeps each old id against its new one. The old ids are
-- no secret — anyone can derive them — and the table is service-only like
-- everything else, but it lets a missed reference be repaired later and makes
-- this reversible (migrations/rollback/0002_…).

create table if not exists booking_id_reissues (
  old_id       uuid primary key,
  new_id       uuid not null unique,
  reference    text not null,
  reissued_at  timestamptz not null default now(),
  tenant_id    uuid not null default public.current_tenant_id() references public.tenants (id)
);
alter table booking_id_reissues enable row level security;

do $block$
declare
  s record;
  m record;
  body text;
begin
  insert into booking_id_reissues (old_id, new_id, reference)
  select b.id, gen_random_uuid(), b.reference
  from bookings b
  where b.reference like 'VB-L%'
    and substr(b.id::text, 15, 1) = '5'
    and not exists (select 1 from booking_id_reissues r where r.old_id = b.id);

  update reward_codes t set earned_booking = r.new_id
    from booking_id_reissues r where t.earned_booking = r.old_id;
  update reward_codes t set used_booking = r.new_id
    from booking_id_reissues r where t.used_booking = r.old_id;
  update booking_requests t set booking_id = r.new_id
    from booking_id_reissues r where t.booking_id = r.old_id;

  -- Settings are few; only those holding a version-5 uuid are even read.
  for s in select key, value::text as txt from settings
           where value::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-' loop
    body := s.txt;
    for m in select old_id::text as o, new_id::text as n from booking_id_reissues
             where position(old_id::text in s.txt) > 0 loop
      body := replace(body, m.o, m.n);
    end loop;
    if body <> s.txt then
      update settings set value = body::jsonb where key = s.key;
    end if;
  end loop;

  alter table bookings disable trigger booking_email_stats_trg;
  update bookings b set id = r.new_id
    from booking_id_reissues r where b.id = r.old_id;
  alter table bookings enable trigger booking_email_stats_trg;
end
$block$;

notify pgrst, 'reload schema';
