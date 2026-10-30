-- Repeating blocks: take the same sessions out of service week after week.
--
-- slot_blocks holds one row per room, date and time, which is right for a
-- private event and hopeless for "we can't staff Monday mornings any more":
-- that was a manager texting the owner, and the owner blocking slots one date
-- at a time. A rule here names a room, weekdays and start times, from a date
-- and either until a date or (date_to null) until someone removes it.
--
-- Nothing is expanded into slot_blocks. Availability reads both tables
-- (lib/blocks.ts, blockedKeysForDate), so removing a rule puts every one of its
-- sessions back on sale at once, and an open-ended rule never runs out.

create table if not exists public.slot_block_rules (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default public.current_tenant_id() references public.tenants (id),
  room_id     text not null,
  weekdays    integer[] not null,       -- 0 = Sunday … 6 = Saturday
  times       text[] not null,          -- HH:MM start times
  date_from   date not null,
  date_to     date,                     -- null = until removed
  reason      text not null,
  blocked_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists slot_block_rules_room on public.slot_block_rules (tenant_id, room_id);

alter table public.slot_block_rules enable row level security;
grant select, insert, update, delete on public.slot_block_rules to tenant_app;
drop policy if exists tenant_isolation on public.slot_block_rules;
create policy tenant_isolation on public.slot_block_rules for all to tenant_app
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

notify pgrst, 'reload schema';
