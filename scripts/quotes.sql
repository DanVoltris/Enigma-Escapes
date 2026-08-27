-- Invoices raised before a booking exists (Bookings -> Invoices).
--
-- A quote holds no slot and takes no money: it is a document a corporate
-- customer can take to their accounts department. Run this once per database.
create table if not exists quotes (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,        -- INV-XXXXXX, what the customer quotes back
  token           text not null unique,        -- the secret in the public link
  created_at      timestamptz not null default now(),
  created_by      text,
  customer        jsonb not null,              -- {name, email, phone, company}
  lines           jsonb not null default '[]'::jsonb,
  discount_cents  int not null default 0,
  tax_percent     numeric not null default 0,
  note            text,
  status          text not null default 'draft',  -- draft | sent | void
  sent_at         timestamptz,
  sent_to         text,
  expires_on      date
);

-- Added after the first invoices were raised: a corporate event carries one
-- fee for the whole invoice, however many rooms it covers.
alter table quotes add column if not exists corporate boolean not null default false;
alter table quotes add column if not exists flat_fee_cents int not null default 0;

alter table quotes enable row level security;
create index if not exists quotes_created_idx on quotes (created_at desc);
