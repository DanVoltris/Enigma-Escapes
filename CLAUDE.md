# Voltris Booking

Escape-room booking web app: browse availability → select slot & quantity → cart with 15-minute
hold → contact details → payment (full or 25% deposit) → confirmation. Plus a staff manager
portal at `/manager` (Dashboard, Calendar, Bookings, Customers, Experiences, Promo codes,
Reports, Help). The manager portal has NO login yet — do not share the URL publicly; it is
noindexed. Adding auth is the top follow-up task.

Stack: Next.js (App Router) + TypeScript + React. Supabase (project ref `naztszcfcbjqxxvyydjr`)
stores `bookings`, `experiences`, and `promo_codes`, accessed server-side only via the
PostgREST API with plain `fetch` — no Supabase SDK dependency. Route groups: `app/(site)` is
the customer flow (own layout with cart header), `app/manager` is the portal (own layout,
top-tab nav).

## Run locally

```
npm install
npm run dev
```

Then open http://localhost:3000. Requires `.env.local` (gitignored) with:

```
SUPABASE_URL=https://naztszcfcbjqxxvyydjr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key — Supabase dashboard → Settings → API keys>
```

The same two variables are set on Vercel for production. The service_role key bypasses row
level security, so it must only ever be used server-side (lib/db.ts) and never committed.

### Local mock data (no Supabase)

To run with no database at all, add `USE_LOCAL_DATA=true` to `.env.local`. All data access is
then served by a local file-backed store (`lib/local-db.ts`) seeded with sample experiences, a
promo code (`WELCOME10`), taxes and one demo booking. Data persists to `.local-data.json` at the
project root (gitignored) — delete that file to reset to the seed. The flag is development-only:
Vercel doesn't set it, so production keeps using Supabase. Remove the line to switch back locally.

## How it works

- Experiences (rooms, prices, daily times, colors) live in the `experiences` table, managed
  from `/manager/experiences`. Promo codes live in `promo_codes`, managed from
  `/manager/promos`. Both editable without deploys.
- Availability is served by `GET /api/availability?date=YYYY-MM-DD` from real bookings only
  (the old fake "seeded" availability was removed when the portal arrived — new slots start
  fully open).
- Bookings are created via `POST /api/bookings`, which revalidates availability, the promo
  code, and all prices server-side (client totals are never trusted). Minimum party size is 3
  (`MIN_PARTY_SIZE`).
- All tables have row level security enabled with no policies: the public anon key can touch
  nothing; all access goes through the service_role key in server code (`lib/supabase.ts`).
- Manager write APIs live under `/api/manager/*` — currently unauthenticated (owner's choice
  for now); they validate all input.
- Payment: simulated by default (card validated in the browser, nobody charged). With
  `STRIPE_SECRET_KEY` (+ `STRIPE_WEBHOOK_SECRET`) in the environment, checkout switches to
  Stripe-hosted Checkout Sessions: the booking is saved as `status: "pending"` (holds its spots
  for 30 min, then stops counting), and is finalized to `paid` on the redirect return AND by the
  `/api/stripe/webhook` endpoint (`checkout.session.completed`), idempotently. Stripe keys are
  env-only — never stored via the portal (no auth yet). On Supabase, `bookings` needs `status` +
  `pending_expires_at` columns first (SQL shown on Settings → Marketing & tracking). Promo code
  `WELCOME10` gives 10% off.
- Partner API (keys under settings key `partner_api_keys`, managed on Settings → Marketing &
  tracking, `lib/api-keys.ts`): `GET /api/partner/availability?date=…` serves live slots +
  booking deep links (e.g. Morty); `GET /api/partner/bookings?date=…` serves played sessions for
  photo partners (e.g. Fotaflo) — deliberately PII-free (no emails/phones) until portal auth
  exists. A business-wide virtual-game meeting link (integrations `zoomUrl`) shows on
  confirmations when enabled.
- Customers: the Customers tab merges booking-derived people with manually added ones
  (`+ Add customer`, stored in a `customers` table keyed by email, `lib/customers.ts`; also
  suggested in the walk-in lookup). Supabase needs: `create table customers (email text primary
  key, first_name text not null, last_name text not null, phone text, subscribe boolean not null
  default false, created_at timestamptz not null default now()); alter table customers enable
  row level security;` (local mode needs nothing).
- Blocked hours: managers take sessions out of service on `/manager/blocks` (linked from
  Calendar) — per-slot rows in `slot_blocks`. Blocked slots are hidden from availability (site
  + partner feed) and refused by create-booking (walk-ins included) and the requests API.
- Booking requests: sessions starting within 4 hours (`REQUEST_WINDOW_MINUTES`, lib/format.ts)
  aren't self-serve — the site collects a request (name + phone, no payment) into
  `booking_requests`; managers accept/decline on `/manager/requests` (accept texts a completion
  link `/request/<token>` that seeds the cart and passes `requestToken` through checkout, which
  create-booking requires for sub-4h slots; walk-ins exempt). Requests expire at session start.
- Checklists: daily staff task lists at `/manager/checklists` (definitions + today's ticks in
  settings keys `checklists` / `checklist_state`; ticks reset at date rollover).
- Surveys: public post-game form at `/feedback` (linked with the reference from every
  confirmation), one response per booking, shown under Reports → Surveys. Supabase needs:
  `create table feedback (reference text primary key, rating int not null, comment text,
  name text, created_at timestamptz not null default now()); alter table feedback enable row
  level security;` (local mode needs nothing).
- Game results: staff log each session's outcome (escaped, minutes left, hints) on the manager
  booking page (`game_result` jsonb column — on Supabase run the ALTER TABLE shown on the
  Stripe integrations card); Reports → Games shows per-room escape rates.
- Marketing integrations (Meta Pixel, Google Tag Manager) are configured in Settings →
  Marketing & tracking (settings key `integrations`, ID fields only — never raw scripts). The
  customer site layout injects the snippets only when a validated ID is enabled, and the funnel
  fires AddToCart / InitiateCheckout / Purchase to the Pixel and the GTM dataLayer
  (`lib/tracking.ts`). The manager portal is never tracked.
- Cart state (items, customer info, hold timer) lives in React context persisted to
  localStorage (`lib/cart.tsx`).

## Design rules

- White background, sharp corners (no border-radius anywhere), light sky blue accent
  (`--accent: #87cefa`), Source Sans 3 typeface. Tokens live in `app/globals.css`.
