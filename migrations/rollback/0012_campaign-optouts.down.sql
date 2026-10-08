-- Puts the counts back to sent/failed/pending and forgets which campaign each
-- unsubscribe followed. The opt-outs themselves are untouched — nobody who left
-- comes back on by undoing this.
drop function if exists public.campaign_progress(uuid);
drop function if exists public.campaign_progress_all();
alter table public.sms_optouts drop column if exists campaign_id;
notify pgrst, 'reload schema';
