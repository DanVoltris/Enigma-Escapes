-- Which campaign an unsubscribe followed.
--
-- sms_optouts has always recorded every STOP and when it arrived, but not what
-- prompted it, so "how many people did that message cost us?" could not be
-- answered — the one number that says whether a campaign landed badly.
--
-- The link is the campaign that last texted that number BEFORE they stopped.
-- Exact from here on, because the inbound webhook records it as the reply
-- arrives; a fair guess for what is already in the table, which the backfill
-- below settles the same way. Someone who replied STOP having been texted by
-- two campaigns is counted against the later one.
--
-- Deliberately NOT counted: a send Twilio refuses with 21610 ("they replied
-- STOP to us before"). That person left some earlier time — often before this
-- venue ever sent a campaign — and counting them would blame this message for
-- somebody else's decision. Those rows are recorded with source 'carrier' and
-- no campaign.

alter table public.sms_optouts
  add column if not exists campaign_id uuid references public.campaigns (id) on delete set null;

create index if not exists sms_optouts_campaign
  on public.sms_optouts (tenant_id, campaign_id);

-- Settle the history. Only rows that are plainly a reply (never the carrier's
-- older opt-outs), and only against a campaign that had actually reached that
-- number first — status 'sent', sent_at at or before the STOP.
update public.sms_optouts o
   set campaign_id = (
     select r.campaign_id
       from public.campaign_recipients r
      where r.tenant_id = o.tenant_id
        and r.phone = o.phone
        and r.status = 'sent'
        and r.sent_at is not null
        and r.sent_at <= o.created_at
      order by r.sent_at desc
      limit 1
   )
 where o.campaign_id is null
   and coalesce(o.source, 'reply') = 'reply';

-- The counts the portal shows. The return type gains a column, which CREATE OR
-- REPLACE cannot do, so both are dropped first.
drop function if exists public.campaign_progress(uuid);
create or replace function public.campaign_progress(p_campaign_id uuid)
returns table (sent bigint, failed bigint, pending bigint, unsubscribed bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select count(*) filter (where r.status = 'sent'),
         count(*) filter (where r.status = 'failed'),
         count(*) filter (where r.status = 'pending'),
         (select count(*)
            from public.sms_optouts o
           where o.tenant_id = (select public.current_tenant_id())
             and o.campaign_id = p_campaign_id)
  from public.campaign_recipients r
  where r.tenant_id = (select public.current_tenant_id())
    and r.campaign_id = p_campaign_id;
$$;

drop function if exists public.campaign_progress_all();
create or replace function public.campaign_progress_all()
returns table (campaign_id uuid, sent bigint, failed bigint, pending bigint, unsubscribed bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with stopped as (
    select o.campaign_id, count(*) as people
      from public.sms_optouts o
     where o.tenant_id = (select public.current_tenant_id())
       and o.campaign_id is not null
     group by o.campaign_id
  )
  select r.campaign_id,
         count(*) filter (where r.status = 'sent'),
         count(*) filter (where r.status = 'failed'),
         count(*) filter (where r.status = 'pending'),
         coalesce(max(s.people), 0)
  from public.campaign_recipients r
  left join stopped s on s.campaign_id = r.campaign_id
  where r.tenant_id = (select public.current_tenant_id())
  group by r.campaign_id;
$$;

grant execute on function public.campaign_progress(uuid) to tenant_app;
grant execute on function public.campaign_progress_all() to tenant_app;

notify pgrst, 'reload schema';
