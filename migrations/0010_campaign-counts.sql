-- Counting, without hauling the answers across the wire.
--
-- The Marketing page opened in about eleven seconds: to list the area codes it
-- read every number in the audience — twenty thousand rows, a thousand at a
-- time — and grouped them in the app. The campaign list did the same kind of
-- thing per campaign, three count queries each.
--
-- These three do the counting where the rows already are. They build on
-- campaign_audience (migrations/0009) rather than restating its rules, so there
-- is still one definition of who may be texted.

create or replace function public.campaign_area_codes()
returns table (code text, people bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select left(a.phone, 3) as code, count(*) as people
  from public.campaign_audience(null, true, null, null) a
  group by 1
  order by 2 desc, 1 asc;
$$;

create or replace function public.campaign_audience_count(
  months integer,
  include_subscribers boolean,
  area_codes text[],
  locations text[]
) returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*) from public.campaign_audience(months, include_subscribers, area_codes, locations);
$$;

-- Sent / failed / still to go, for one campaign or for all of them at once.
create or replace function public.campaign_progress(p_campaign_id uuid)
returns table (sent bigint, failed bigint, pending bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select count(*) filter (where r.status = 'sent'),
         count(*) filter (where r.status = 'failed'),
         count(*) filter (where r.status = 'pending')
  from public.campaign_recipients r
  where r.tenant_id = (select public.current_tenant_id())
    and r.campaign_id = p_campaign_id;
$$;

create or replace function public.campaign_progress_all()
returns table (campaign_id uuid, sent bigint, failed bigint, pending bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select r.campaign_id,
         count(*) filter (where r.status = 'sent'),
         count(*) filter (where r.status = 'failed'),
         count(*) filter (where r.status = 'pending')
  from public.campaign_recipients r
  where r.tenant_id = (select public.current_tenant_id())
  group by r.campaign_id;
$$;

grant execute on function public.campaign_area_codes() to tenant_app;
grant execute on function public.campaign_audience_count(integer, boolean, text[], text[]) to tenant_app;
grant execute on function public.campaign_progress(uuid) to tenant_app;
grant execute on function public.campaign_progress_all() to tenant_app;

notify pgrst, 'reload schema';
