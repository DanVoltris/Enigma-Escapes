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

## How it works

- Experiences (rooms, prices, daily times, colors) live in the `experiences` table, managed
  from `/manager/experiences`. Promo codes live in `promo_codes`, managed from
  `/manager/promos`. Both editable without deploys.
- Availability is served by `GET /api/availability?date=YYYY-MM-DD` from real bookings only
  (the old fake "seeded" availability was removed when the portal arrived — new slots start
  fully open).
- Bookings are created via `POST /api/bookings`, which revalidates availability, the promo
  code, and all prices server-side (client totals are never trusted). Minimum party size is 4
  (`MIN_PARTY_SIZE`).
- All tables have row level security enabled with no policies: the public anon key can touch
  nothing; all access goes through the service_role key in server code (`lib/supabase.ts`).
- Manager write APIs live under `/api/manager/*` — currently unauthenticated (owner's choice
  for now); they validate all input.
- Payment is simulated: card details are validated in the browser (Luhn + expiry) and never sent
  to the server. Promo code `WELCOME10` gives 10% off.
- Cart state (items, customer info, hold timer) lives in React context persisted to
  localStorage (`lib/cart.tsx`).

## Design rules

- White background, sharp corners (no border-radius anywhere), light sky blue accent
  (`--accent: #87cefa`), Source Sans 3 typeface. Tokens live in `app/globals.css`.
