-- Complete schema for Voltris Booking — run once in the Supabase SQL Editor
-- of a fresh project (Dashboard → SQL Editor → paste → Run).
-- Everything the current code uses, including the newer columns/tables.
-- All tables get row level security with NO policies: the public anon key can
-- touch nothing; the app talks to PostgREST server-side with the service key.

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table settings enable row level security;

create table if not exists experiences (
  id text primary key,
  name text not null,
  location text not null default '',
  tagline text not null default '',
  description text not null default '',
  duration_minutes int not null default 60,
  capacity int not null default 8,
  price_cents int not null default 0,
  min_party int not null default 4,
  max_party int not null default 8,
  private boolean not null default false,
  deposit_percent numeric not null default 25,
  schedule_mode text not null default 'times',
  times jsonb not null default '[]',
  interval_minutes int not null default 75,
  windows jsonb not null default '{}',
  badge_bg text not null default '#0B2540',
  badge_fg text not null default '#FFFFFF',
  image_url text,
  active boolean not null default true,
  sort int not null default 0
);
alter table experiences enable row level security;

create table if not exists promo_codes (
  code text primary key,
  percent_off numeric not null,
  active boolean not null default true
);
alter table promo_codes enable row level security;

create table if not exists bookings (
  id uuid primary key,
  reference text not null,
  created_at timestamptz not null default now(),
  customer jsonb not null,
  items jsonb not null,
  promo_code text,
  payment_option text not null default 'full',
  pricing jsonb not null,
  source text not null default 'online',
  no_show boolean not null default false,
  status text,                -- 'pending' during Stripe checkout, else paid
  pending_expires_at timestamptz,
  game_result jsonb           -- staff-recorded outcome (escaped, time, hints)
);
alter table bookings enable row level security;

create table if not exists location_hours (
  location text primary key,
  hours jsonb not null default '{}'
);
alter table location_hours enable row level security;

create table if not exists taxes (
  id text primary key,
  name text not null,
  percent numeric not null,
  active boolean not null default true,
  sort int not null default 0
);
alter table taxes enable row level security;

create table if not exists staff_notes (
  id uuid primary key,
  note text not null,
  created_at timestamptz not null default now()
);
alter table staff_notes enable row level security;

create table if not exists activity_log (
  id uuid primary key,
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
alter table activity_log enable row level security;

create table if not exists customers (
  email text primary key,
  first_name text not null,
  last_name text not null,
  phone text,
  subscribe boolean not null default false,
  created_at timestamptz not null default now()
);
alter table customers enable row level security;

create table if not exists feedback (
  reference text primary key,
  rating int not null,
  comment text,
  name text,
  created_at timestamptz not null default now()
);
alter table feedback enable row level security;

-- NOT SQL: also create a public Storage bucket named  experience-images
-- (Dashboard → Storage → New bucket → name: experience-images → Public).
-- Room/logo image uploads go there.

-- Booking requests (sub-4-hour bookings needing manager approval)
create table if not exists booking_requests (
  id uuid primary key,
  created_at timestamptz not null default now(),
  room_id text not null, room_name text not null, location text not null,
  date text not null, time text not null, quantity int not null,
  first_name text not null, last_name text not null default '',
  phone text not null, email text,
  status text not null default 'pending',
  token text not null unique,
  decided_at timestamptz, booking_id uuid
);
alter table booking_requests enable row level security;

-- Manager-blocked time slots (maintenance, private events): blocked slots are
-- hidden from the booking site and refused by the booking/request APIs.
create table if not exists slot_blocks (
  id uuid primary key,
  room_id text not null,
  date text not null,
  time text not null,
  reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists slot_blocks_unique on slot_blocks (room_id, date, time);
alter table slot_blocks enable row level security;

-- Staff portal logins. Passwords are scrypt-hashed by the app; sessions store
-- only a hash of the cookie token, and are deleted to revoke access instantly.
create table if not exists staff_accounts (
  id uuid primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null default 'clerk',
  locations jsonb not null default '[]'::jsonb,
  permissions jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
alter table staff_accounts enable row level security;

create table if not exists staff_sessions (
  token_hash text primary key,
  staff_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table staff_sessions enable row level security;

-- Gift vouchers: prepaid dollar balances (distinct from promo_codes, which are
-- percentage discounts). remaining_cents is the outstanding liability.
create table if not exists gift_vouchers (
  code text primary key,
  face_cents integer not null,
  remaining_cents integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  purchaser text,
  email text,
  message text,
  last_used_at timestamptz
);
alter table gift_vouchers enable row level security;
create index if not exists gift_vouchers_created_idx on gift_vouchers (created_at desc);
