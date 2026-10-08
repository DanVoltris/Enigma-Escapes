-- Drops the record of texts sent. Nothing else reads this table, so losing it
-- costs only the history.
drop table if exists public.sms_messages;
notify pgrst, 'reload schema';
