import { randomUUID } from "crypto";
import { rest, restError } from "./supabase";
import type { ActivityEntry, Booking, BookingSource, Promo, StaffNote } from "./types";

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
  source: BookingSource;
  no_show: boolean;
  // Stripe checkout columns — optional so rows from the pre-Stripe schema
  // still read fine (missing = paid, the historical meaning).
  status?: string | null;
  pending_expires_at?: string | null;
  // Staff-recorded game outcome; optional for the same schema-compat reason.
  game_result?: Booking["gameResult"];
};

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
    source: row.source ?? "online",
    noShow: row.no_show ?? false,
    status: row.status === "pending" ? "pending" : "paid",
    pendingExpiresAt: row.pending_expires_at ?? null,
    gameResult: row.game_result ?? null,
  };
}

// Records (or re-records) how a session went. Own function rather than
// updateBookingFields so the game_result column is only ever written here —
// pre-migration Supabase schemas break on unknown columns.
export async function saveGameResult(id: string, result: Booking["gameResult"]): Promise<void> {
  if (!UUID_RE.test(id)) throw new Error("Invalid booking id.");
  const res = await rest(`bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ game_result: result }),
  });
  if (!res.ok) throw await restError(res, "Saving the game result");
}

// A booking that should count against availability and appear in the manager:
// paid, or a pending Stripe checkout whose hold hasn't lapsed yet.
export function isLiveBooking(b: Booking): boolean {
  if (b.status !== "pending") return true;
  return b.pendingExpiresAt !== null && b.pendingExpiresAt > new Date().toISOString();
}

// Same test on a raw row, for queries that don't build full bookings.
function rowIsLive(status: string | null | undefined, pendingExpiresAt: string | null | undefined): boolean {
  if ((status ?? "paid") !== "pending") return true;
  return pendingExpiresAt != null && pendingExpiresAt > new Date().toISOString();
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
    source: booking.source,
    no_show: booking.noShow,
    // Only pending (Stripe) bookings write the new columns, so the simulated
    // flow keeps working on a bookings table that predates them.
    ...(booking.status === "pending"
      ? { status: booking.status, pending_expires_at: booking.pendingExpiresAt }
      : {}),
  };
  const res = await rest("bookings", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw await restError(res, "Saving the booking");
}

// Marks a pending Stripe booking as paid, recording what was actually charged.
// Idempotent — the webhook and the redirect-return can both call it.
export async function finalizeBookingPayment(id: string, paidCents: number): Promise<Booking | undefined> {
  const booking = await getBooking(id);
  if (!booking) return undefined;
  if (booking.status === "paid") return booking;
  const pricing: Booking["pricing"] = {
    ...booking.pricing,
    paidCents,
    balanceCents: booking.pricing.totalCents - paidCents,
  };
  const res = await rest(`bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "paid", pending_expires_at: null, pricing }),
  });
  if (!res.ok) throw await restError(res, "Recording the payment");
  return { ...booking, status: "paid", pendingExpiresAt: null, pricing };
}

export async function setBookingNoShow(id: string, noShow: boolean): Promise<void> {
  if (!UUID_RE.test(id)) throw new Error("Invalid booking id.");
  const res = await rest(`bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ no_show: noShow }),
  });
  if (!res.ok) throw await restError(res, "Updating the booking");
}

// Patch a booking's editable fields (staff actions: promo, payments,
// participants). Whole-column JSONB writes — last writer wins, fine at this
// scale with one staff terminal.
export async function updateBookingFields(
  id: string,
  patch: { pricing?: Booking["pricing"]; customer?: Booking["customer"]; promoCode?: string | null }
): Promise<void> {
  if (!UUID_RE.test(id)) throw new Error("Invalid booking id.");
  const row: Partial<BookingRow> = {};
  if (patch.pricing) row.pricing = patch.pricing;
  if (patch.customer) row.customer = patch.customer;
  if (patch.promoCode !== undefined) row.promo_code = patch.promoCode;
  if (Object.keys(row).length === 0) return;
  const res = await rest(`bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw await restError(res, "Updating the booking");
}

export async function getBooking(id: string): Promise<Booking | undefined> {
  if (!UUID_RE.test(id)) return undefined;
  const res = await rest(`bookings?id=eq.${id}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Loading the booking");
  const rows = (await res.json()) as BookingRow[];
  return rows[0] ? toBooking(rows[0]) : undefined;
}

// Lookup by public reference (used by the feedback form to verify it's real).
export async function getBookingByReference(reference: string): Promise<Booking | undefined> {
  if (!/^VB-[A-Z0-9]{4,10}$/i.test(reference)) return undefined;
  const res = await rest(`bookings?reference=eq.${encodeURIComponent(reference.toUpperCase())}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Looking up the booking");
  const rows = (await res.json()) as BookingRow[];
  return rows[0] ? toBooking(rows[0]) : undefined;
}

// Every live booking, newest first (expired unpaid checkouts drop out). Fine
// at this scale; add pagination when the venue has thousands of bookings.
export async function listBookings(): Promise<Booking[]> {
  const res = await rest("bookings?select=*&order=created_at.desc");
  if (!res.ok) throw await restError(res, "Loading bookings");
  return ((await res.json()) as BookingRow[]).map(toBooking).filter(isLiveBooking);
}

// All booked spot counts for one date, keyed "roomId|time". One query per date
// (the availability page needs every slot) using a jsonb contains filter.
// Live pending checkouts count — their spots are held until they expire.
export async function bookedCountsForDate(date: string): Promise<Map<string, number>> {
  const filter = encodeURIComponent(JSON.stringify([{ date }]));
  const res = await rest(`bookings?select=items,status,pending_expires_at&items=cs.${filter}`);
  if (!res.ok) throw await restError(res, "Loading availability");
  const rows = (await res.json()) as Pick<BookingRow, "items" | "status" | "pending_expires_at">[];
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!rowIsLive(row.status, row.pending_expires_at)) continue;
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

// Every booking that touches one date, newest first. Same scoped jsonb-contains
// query as bookedCountsForDate, but returns the full bookings so the calendar
// can show each session's customers and balances (and derive its own counts).
export async function bookingsForDate(date: string): Promise<Booking[]> {
  const filter = encodeURIComponent(JSON.stringify([{ date }]));
  const res = await rest(`bookings?select=*&items=cs.${filter}&order=created_at.desc`);
  if (!res.ok) throw await restError(res, "Loading the day's bookings");
  return ((await res.json()) as BookingRow[]).map(toBooking).filter(isLiveBooking);
}

// ---------- promo codes ----------

type PromoRow = { code: string; percent_off: number; active: boolean };

export async function getPromo(code: string): Promise<Promo | undefined> {
  const res = await rest(`promo_codes?code=eq.${encodeURIComponent(code)}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Checking the promo code");
  const rows = (await res.json()) as PromoRow[];
  return rows[0] ? { code: rows[0].code, percentOff: rows[0].percent_off, active: rows[0].active } : undefined;
}

export async function listPromos(): Promise<Promo[]> {
  const res = await rest("promo_codes?select=*&order=code.asc");
  if (!res.ok) throw await restError(res, "Loading promo codes");
  return ((await res.json()) as PromoRow[]).map((r) => ({
    code: r.code,
    percentOff: r.percent_off,
    active: r.active,
  }));
}

export async function createPromo(promo: Promo): Promise<void> {
  const res = await rest("promo_codes", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ code: promo.code, percent_off: promo.percentOff, active: promo.active }),
  });
  if (!res.ok) throw await restError(res, "Creating the promo code");
}

export async function updatePromo(code: string, patch: { percentOff?: number; active?: boolean }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.percentOff !== undefined) row.percent_off = patch.percentOff;
  if (patch.active !== undefined) row.active = patch.active;
  const res = await rest(`promo_codes?code=eq.${encodeURIComponent(code)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw await restError(res, "Updating the promo code");
}

// Safe to delete: bookings store the promo code as text with the price already
// applied, so existing bookings are unaffected.
export async function deletePromo(code: string): Promise<void> {
  const res = await rest(`promo_codes?code=eq.${encodeURIComponent(code)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok) throw await restError(res, "Removing the promo code");
}

// ---------- staff notes ----------

type StaffNoteRow = { id: string; note: string; created_at: string };

export async function listStaffNotes(): Promise<StaffNote[]> {
  const res = await rest("staff_notes?select=*&order=created_at.desc");
  if (!res.ok) throw await restError(res, "Loading staff notes");
  return ((await res.json()) as StaffNoteRow[]).map((r) => ({ id: r.id, note: r.note, createdAt: r.created_at }));
}

export async function addStaffNote(note: string): Promise<void> {
  const res = await rest("staff_notes", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ id: randomUUID(), note }),
  });
  if (!res.ok) throw await restError(res, "Saving the note");
}

export async function deleteStaffNote(id: string): Promise<void> {
  if (!UUID_RE.test(id)) throw new Error("Invalid note id.");
  const res = await rest(`staff_notes?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!res.ok) throw await restError(res, "Deleting the note");
}

// ---------- activity log ----------

type ActivityRow = { id: string; action: string; detail: string; created_at: string };

// Best-effort audit trail. Never throws — a logging failure must not break the
// action that triggered it.
export async function logActivity(action: string, detail: string): Promise<void> {
  try {
    await rest("activity_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ id: randomUUID(), action, detail }),
    });
  } catch (err) {
    console.error("activity log write failed:", err);
  }
}

export async function listActivity(limit = 10): Promise<ActivityEntry[]> {
  const res = await rest(`activity_log?select=*&order=created_at.desc&limit=${limit}`);
  if (!res.ok) throw await restError(res, "Loading activity");
  return ((await res.json()) as ActivityRow[]).map((r) => ({
    id: r.id,
    action: r.action,
    detail: r.detail,
    createdAt: r.created_at,
  }));
}
