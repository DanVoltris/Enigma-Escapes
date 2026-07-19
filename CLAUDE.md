# Voltris Booking

Escape-room booking web app: browse availability → select slot & quantity → cart with 15-minute
hold → contact details → payment (full or 25% deposit) → confirmation.

Stack: Next.js (App Router) + TypeScript + React. Bookings are stored in Supabase
(`bookings` table, project ref `naztszcfcbjqxxvyydjr`), accessed server-side only via the
PostgREST API with plain `fetch` — no Supabase SDK dependency.

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

- Rooms/experiences and their daily time slots are defined in `lib/rooms.ts`.
- Availability is served by `GET /api/availability?date=YYYY-MM-DD`. It combines real bookings
  with a deterministic demo baseline (`lib/availability.ts`) so some slots appear partly booked
  or sold out — remove `seededBooked` when real inventory management is added.
- Bookings are created via `POST /api/bookings`, which revalidates availability and recomputes
  all prices server-side (client totals are never trusted).
- The `bookings` table has row level security enabled with no policies: the public anon key can
  touch nothing; all access goes through the service_role key in server code.
- Payment is simulated: card details are validated in the browser (Luhn + expiry) and never sent
  to the server. Promo code `WELCOME10` gives 10% off.
- Cart state (items, customer info, hold timer) lives in React context persisted to
  localStorage (`lib/cart.tsx`).

## Design rules

- White background, sharp corners (no border-radius anywhere), light sky blue accent
  (`--accent: #87cefa`), Source Sans 3 typeface. Tokens live in `app/globals.css`.
