-- Phone notifications for staff (Web Push), alongside the texts.
--
-- One row per staff account per phone that has turned notifications on. A
-- phone is identified by the endpoint its browser was handed by Apple or
-- Google; the two keys are what the message is encrypted to. Nothing in a row
-- identifies a customer.
--
-- The dates are there so a phone can be warned before its notifications fade
-- out and told when they have: last_seen_at moves whenever the portal is opened
-- on that phone, last_delivered_at on every push Apple or Google accepts,
-- nudged_at when it was reminded to open the app after a long gap, and
-- stopped_at when a push came back "gone" — at which point stop_texted_at
-- records that the person was texted about it, once.
--
-- Which alerts a person wants is theirs, not their phone's, so it lives on the
-- account (notify_prefs); null means the defaults in lib/push.ts.
--
-- A new small table and a nullable column: no rewrite, no long lock, safe to
-- run while a venue is open.

create table if not exists public.push_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default public.current_tenant_id() references public.tenants (id),
  staff_id           uuid not null references public.staff_accounts (id) on delete cascade,
  endpoint           text not null,
  p256dh             text not null,
  auth               text not null,
  device             text,
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  last_delivered_at  timestamptz,
  nudged_at          timestamptz,
  stopped_at         timestamptz,
  stop_reason        text,
  stop_texted_at     timestamptz
);

-- Unique within a business, the same rule 0003 gave every other natural key.
create unique index if not exists push_subscriptions_tenant_endpoint_key
  on public.push_subscriptions (tenant_id, endpoint);
create index if not exists push_subscriptions_tenant_staff
  on public.push_subscriptions (tenant_id, staff_id);

alter table public.staff_accounts add column if not exists notify_prefs jsonb;

-- The isolation 0004 gave every tenant table. That migration found tables by
-- their tenant_id column when it ran, so a table added after it has to be given
-- the same policy here.
alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on public.push_subscriptions to tenant_app;
drop policy if exists tenant_isolation on public.push_subscriptions;
create policy tenant_isolation on public.push_subscriptions for all to tenant_app
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

notify pgrst, 'reload schema';
