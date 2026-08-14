# Voltris Booking

Escape-room booking web app: browse availability → select slot & quantity → cart with 15-minute
hold → contact details → payment (full or 25% deposit) → confirmation. Plus a staff portal at
`/manager` (Dashboard, Calendar, Bookings, Requests, Customers, Experiences, Promo codes,
Checklists, Notes, Reports, Settings, Help).

The staff portal requires a login (`/login`). Accounts live in `staff_accounts`, sessions in
`staff_sessions` (scrypt passwords, SHA-256'd cookie tokens, revocable — `lib/staff.ts`).
Roles (admin / manager / clerk) are presets over 15 individual permissions
(`lib/permissions.ts`); admins tick them per account in Settings → Team, and can scope an
account to particular locations. Guards live in `lib/auth.ts`: pages call
`requirePermission(...)`, API routes call `apiGuard(...)` — every restricted surface re-checks
server-side, so hiding a nav tab is never the security boundary. With zero accounts, `/login`
becomes a one-time first-admin setup that closes permanently once an account exists.

Stack: Next.js (App Router) + TypeScript + React. Supabase (project ref `dvpqsqnnvfjcgvtatfzo`)
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
SUPABASE_URL=https://dvpqsqnnvfjcgvtatfzo.supabase.co
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
- Gift vouchers are two things in two places. **Gift vouchers** (`/manager/vouchers`,
  `voucher_products`) is the catalogue — what customers can buy, with a switch per
  product to take it on and off sale, and per-product sales figures. **Promo codes**
  (`/manager/promos`) holds every code in circulation: percentage promos in
  `promo_codes`, plus every issued balance in `gift_vouchers` — bought by a customer
  (`kind: purchased`) or handed out by staff (`kind: comp`). The public shop at
  `/gift-vouchers` only offers products switched on in the catalogue, and the purchase
  API re-checks that server-side. A voucher with no balance left is forced inactive.
- Spending a voucher: the single code box at checkout takes promo codes and gift vouchers
  alike (`GET /api/promo` looks in `promo_codes`, then `gift_vouchers`), and one of each can
  be used on the same booking — the promo percentage comes off first, then the voucher pays
  what's left. A voucher is payment, not a discount, so it applies to the tax-inclusive total
  and settles the deposit first: hold more voucher than the deposit and there's nothing to pay
  today, with the remainder due at the venue. `pricing.voucherCents` counts inside `paidCents`.
  The balance is only taken once the booking is actually paid (`takeVoucherFor` in lib/db.ts,
  guarded by `voucherRedeemed` so the Stripe webhook and the return page can't both spend it),
  moves under a compare-and-swap so two checkouts can't drain the same code (`spendVoucher`),
  and goes back on the voucher when the booking is cancelled.
- Customers: the Customers tab merges booking-derived people with manually added ones
  (`+ Add customer`, stored in a `customers` table keyed by email, `lib/customers.ts`; also
  suggested in the walk-in lookup). Supabase needs: `create table customers (email text primary
  key, first_name text not null, last_name text not null, phone text, subscribe boolean not null
  default false, created_at timestamptz not null default now()); alter table customers enable
  row level security;` plus `alter table customers add column if not exists imported jsonb;`
  (local mode needs nothing). Clicking a customer's name opens a summary popup
  (`CustomerQuickView`); clicking anywhere else in the row opens their full profile, which also
  works for people who have never booked here.
- Importing customers from the old booking system: `npm run import:customers -- <file.csv>`
  (add `--dry-run` for the summary without writing, `--show=<email>` to inspect one parsed row).
  Takes several files at once, maps columns by header name — the exports' column layout has
  already changed once — and upserts on email, so re-running a file is a no-op. Where the same
  legacy account appears in two exports the newer one wins, decided by the timestamp in the
  filename rather than argument order; two *different* legacy accounts sharing an email have
  their history added together. The old system's per-customer totals land in the `imported`
  jsonb column and show on the Customers tab alongside anything booked here. Walk-in placeholder
  accounts are left out and listed at the end of the run. With `USE_LOCAL_DATA=true` it writes
  to `.local-data.json` instead — the way to preview an import without touching production.
- Importing bookings from the old booking system: `npm run import:bookings -- <file.csv>`
  (`--dry-run`, `--show=<transaction id>`). Sessions sold over there then hold their slot here —
  every room is private, so one live booking makes the slot read "Sold out" — and hang off the
  customer's account by email. The export files one row per session; rows sharing a transaction
  id were one purchase, so they become one booking with several items. Ids and references are
  derived from the transaction id (`VB-L<transaction>`; the app only mints hex after `VB-`, so
  the L can't collide), which makes a re-run an update rather than a duplicate and is what marks
  a booking as imported. Rooms are matched by name — the old names carry the venue, e.g.
  "Shady Grove Sanatorium -Grant Park Shopping Centre" — and anything with no experience here
  (Hollywood Pizza, the party room) is skipped and listed at the end. Desk bookings filed under
  the old system's placeholder accounts keep the name typed at the desk but no email, so they
  never become customer accounts. Money comes from the export's own figures; a session that
  doesn't sit on the room's published start times still imports, and the grid slots it overlaps
  are blocked off (see below) so the room can't be sold twice.
- Legacy history is not counted twice: the customers export's per-customer totals already
  include any session since itemised as an imported booking, so the Customers tab and profile
  show those totals net of what's listed (`itemisedLegacy` in lib/customers.ts).
- Blocked hours: managers take sessions out of service on `/manager/blocks` (linked from
  Calendar) — per-slot rows in `slot_blocks`. Blocked slots are hidden from availability (site
  + partner feed) and refused by create-booking (walk-ins included) and the requests API.
- Self-service changes: the confirmation text and page link to `/booking/<id>` (the booking's
  UUID is the secret), where customers reschedule or cancel until
  `SELF_SERVICE_CUTOFF_MINUTES` (24h, lib/manage-booking.ts) before the session — enforced
  server-side, not just in the UI. Cancelling sets status `cancelled`, which frees the slot and
  drops it from revenue/capacity while staying visible on the Bookings list. Refunds go back
  through Stripe automatically when keys are configured (`pricing.stripePaymentIntent`, saved at
  payment time); otherwise the amount is recorded in `pricing.refundOwedCents` and shown as
  "Refund owed" for staff to settle.
- Staff can cancel or move any booking from its manager page (`BookingActions`,
  `cancelForStaff` / `rescheduleForStaff` in lib/manage-booking.ts). Unlike the
  customer's own link there is no 24-hour cutoff — the phone call an hour before
  is the case staff exist for. Cancelling asks how much to refund (all, part or
  nothing); with Stripe live it goes back automatically, otherwise the amount is
  recorded as owed. Moving can also switch experience, and carries the original
  price across rather than silently re-quoting.
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

## Turning on Stripe

Three environment variables, set in Vercel (Project → Settings → Environment
Variables) and in `.env.local` for local testing. Nothing else changes — the
code already branches on whether the keys are present.

1. `STRIPE_SECRET_KEY` — Stripe Dashboard → Developers → API keys → Secret key.
   Use `sk_test_…` first; swap to `sk_live_…` when you're ready to take money.
2. `STRIPE_WEBHOOK_SECRET` — Developers → Webhooks → Add endpoint:
   URL `https://<your-domain>/api/stripe/webhook`, event
   `checkout.session.completed`. Copy the signing secret (`whsec_…`).
3. Redeploy (Vercel → Deployments → Redeploy). Env vars are read at boot.

What flips on automatically:

- **Bookings** go through Stripe-hosted checkout. The booking saves as
  `pending` (holding its slots for 30 min) and is finalized to `paid` both on
  the customer's return and by the webhook, idempotently.
- **Gift vouchers** do the same: the code is only minted once Stripe confirms
  payment, by whichever of the webhook or return-page lands first (a unique
  index on the session id stops a double issue).
- **Refunds** on customer cancellations go back through Stripe instead of being
  recorded as "refund owed".
- **Terminal** (card reader) charging from the Today screen — see
  Settings → Payments to assign a reader per location.

Verify with Stripe test cards: `4242 4242 4242 4242`, any future expiry, any
CVC. Check Stripe Dashboard → Payments, and the Webhooks page for delivery
attempts if a booking doesn't finalize.

## Design rules

- White background, sharp corners (no border-radius anywhere), light sky blue accent
  (`--accent: #87cefa`), Source Sans 3 typeface. Tokens live in `app/globals.css`.
