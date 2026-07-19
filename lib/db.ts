import type { Booking } from "./types";

// Server-only Supabase access via the PostgREST API. Uses the service_role key,
// which bypasses row level security — it must never be exposed to the browser
// (only ever read here, inside server code, from environment variables).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BookingRow = {
  id: string;
  reference: string;
  created_at: string;
  customer: Booking["customer"];
  items: Booking["items"];
  promo_code: string | null;
  payment_option: Booking["paymentOption"];
  pricing: Booking["pricing"];
};

async function rest(path: string, init?: RequestInit): Promise<Response> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (see CLAUDE.md)."
    );
  }
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
}

async function restError(res: Response, doing: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  return new Error(`${doing} failed (Supabase ${res.status}): ${body.slice(0, 300)}`);
}

function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    reference: row.reference,
    createdAt: row.created_at,
    customer: row.customer,
    items: row.items,
    promoCode: row.promo_code,
    paymentOption: row.payment_option,
    pricing: row.pricing,
  };
}

export async function saveBooking(booking: Booking): Promise<void> {
  const row: BookingRow = {
    id: booking.id,
    reference: booking.reference,
    created_at: booking.createdAt,
    customer: booking.customer,
    items: booking.items,
    promo_code: booking.promoCode,
    payment_option: booking.paymentOption,
    pricing: booking.pricing,
  };
  const res = await rest("bookings", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw await restError(res, "Saving the booking");
}

export async function getBooking(id: string): Promise<Booking | undefined> {
  if (!UUID_RE.test(id)) return undefined;
  const res = await rest(`bookings?id=eq.${id}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Loading the booking");
  const rows = (await res.json()) as BookingRow[];
  return rows[0] ? toBooking(rows[0]) : undefined;
}

// All booked spot counts for one date, keyed "roomId|time". One query per date
// (the availability page needs every slot) using a jsonb contains filter.
export async function bookedCountsForDate(date: string): Promise<Map<string, number>> {
  const filter = encodeURIComponent(JSON.stringify([{ date }]));
  const res = await rest(`bookings?select=items&items=cs.${filter}`);
  if (!res.ok) throw await restError(res, "Loading availability");
  const rows = (await res.json()) as Pick<BookingRow, "items">[];
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const item of row.items) {
      if (item.date !== date) continue;
      const key = `${item.roomId}|${item.time}`;
      counts.set(key, (counts.get(key) ?? 0) + item.quantity);
    }
  }
  return counts;
}

export async function bookedCount(roomId: string, date: string, time: string): Promise<number> {
  const counts = await bookedCountsForDate(date);
  return counts.get(`${roomId}|${time}`) ?? 0;
}
