-- Undo migrations/0002_reissue-imported-booking-ids.sql on one venue. Paste into
-- that venue's SQL editor only if 0002 has to come off.
--
-- Puts every re-issued booking back on its old id, moves the references back,
-- drops booking_id_reissues and un-records 0002. The old ids are derivable
-- again afterwards, but lib/legacy-booking-id.ts recognises them and keeps their
-- public pages closed, so this does not reopen the hole. Any link sent for an
-- imported booking while 0002 was live stops working. Touches no booking's
-- contents, customer or payment.
begin;
do $block$
declare
  s record;
  m record;
  body text;
begin
  if to_regclass('public.booking_id_reissues') is null then
    return; -- 0002 never ran here, or has already been undone
  end if;

  update reward_codes t set earned_booking = r.old_id
    from booking_id_reissues r where t.earned_booking = r.new_id;
  update reward_codes t set used_booking = r.old_id
    from booking_id_reissues r where t.used_booking = r.new_id;
  update booking_requests t set booking_id = r.old_id
    from booking_id_reissues r where t.booking_id = r.new_id;

  for s in select key, value::text as txt from settings
           where value::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-' loop
    body := s.txt;
    for m in select old_id::text as o, new_id::text as n from booking_id_reissues
             where position(new_id::text in s.txt) > 0 loop
      body := replace(body, m.n, m.o);
    end loop;
    if body <> s.txt then
      update settings set value = body::jsonb where key = s.key;
    end if;
  end loop;

  alter table bookings disable trigger booking_email_stats_trg;
  update bookings b set id = r.old_id
    from booking_id_reissues r where b.id = r.new_id;
  alter table bookings enable trigger booking_email_stats_trg;

  drop table booking_id_reissues;
  delete from schema_migrations where version = '0002';
end
$block$;
commit;
notify pgrst, 'reload schema';
