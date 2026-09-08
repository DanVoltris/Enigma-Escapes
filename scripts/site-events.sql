-- First-party site events: what visitors looked for on the booking site and
-- (later) where they stopped. Run once in the Supabase SQL editor. Safe to
-- run twice.
--
-- No personal data lives here. `visitor` is a random cookie id, `props` holds
-- only what each event kind is allowed to carry (see lib/events.ts), and rows
-- older than 180 days are pruned by the Demand report on its way past.
create table if not exists site_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  kind text not null,
  visitor text,
  path text,
  props jsonb not null default '{}'::jsonb
);
create index if not exists site_events_kind_at on site_events (kind, at desc);
alter table site_events enable row level security;

-- Where a booking came from (utm parameters and referrer host), stamped at
-- checkout. Null for walk-ins and for bookings made before this existed.
alter table bookings add column if not exists attribution jsonb;
