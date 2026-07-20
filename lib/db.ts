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
    source: booking.source,
    no_show: booking.noShow,
  };
  const res = await rest("bookings", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw await restError(res, "Saving the booking");
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

export async function getBooking(id: string): Promise<Booking | undefined> {
  if (!UUID_RE.test(id)) return undefined;
  const res = await rest(`bookings?id=eq.${id}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Loading the booking");
  const rows = (await res.json()) as BookingRow[];
  return rows[0] ? toBooking(rows[0]) : undefined;
}

// Every booking, newest first. Fine at this scale; add pagination when the
// venue has thousands of bookings.
export async function listBookings(): Promise<Booking[]> {
  const res = await rest("bookings?select=*&order=created_at.desc");
  if (!res.ok) throw await restError(res, "Loading bookings");
  return ((await res.json()) as BookingRow[]).map(toBooking);
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
