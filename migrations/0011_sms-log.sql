-- A record of every text the app sends, and what became of it.
--
-- Until now a text was fire-and-forget: Twilio's answer was thrown away, an
-- error went to a server log nobody reads, and nothing anywhere could tell
-- staff whether a customer's "reply Y" text had arrived. When customers began
-- saying they never got it, there was no way to tell a message the carrier
-- dropped from one that was never sent.
--
-- Twilio accepting a message only means it is queued. Whether it reached the
-- handset comes minutes later, as a callback to /api/sms/status — which is why
-- status starts at "queued" and is updated in place, keyed on Twilio's own id.
--
-- Marketing is deliberately not logged here: campaign_recipients already holds
-- a row per number per campaign, and a campaign would otherwise bury the
-- handful of rows that matter under ten thousand.

create table if not exists public.sms_messages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default public.current_tenant_id() references public.tenants (id),
  phone         text not null,            -- last 10 digits, as everywhere else
  kind          text not null,            -- request_accepted, booking_confirmed, …
  about         text,                     -- the request id or booking reference it concerns
  status        text not null default 'queued', -- queued|sent|delivered|undelivered|failed
  provider_sid  text,                     -- Twilio's id, what the callback arrives under
  error_code    integer,                  -- Twilio's code: 21610 stopped, 30007 filtered, …
  error_text    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The portal asks "what happened to the texts about these requests?"
create index if not exists sms_messages_about on public.sms_messages (tenant_id, about, created_at desc);
-- The delivery callback arrives with nothing but Twilio's id.
create index if not exists sms_messages_sid on public.sms_messages (provider_sid);
-- "Which texts failed lately", for the health of the number as a whole.
create index if not exists sms_messages_recent on public.sms_messages (tenant_id, created_at desc);

alter table public.sms_messages enable row level security;
grant select, insert, update, delete on public.sms_messages to tenant_app;
drop policy if exists tenant_isolation on public.sms_messages;
create policy tenant_isolation on public.sms_messages for all to tenant_app
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

notify pgrst, 'reload schema';
