import { randomUUID } from "crypto";
import { todayISO } from "./format";
import { rest, restAllPages, restError } from "./supabase";
import { spendVoucher } from "./vouchers";
import type { ActivityEntry, Booking, BookingNote, BookingSource, Promo, StaffNote } from "./types";

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
  notes?: BookingNote[] | null;
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
    status: row.status === "pending" || row.status === "cancelled" ? row.status : "paid",
    pendingExpiresAt: row.pending_expires_at ?? null,
    gameResult: row.game_result ?? null,
    notes: row.notes ?? [],
  };
}

// Rewrites one staff note in place. System notes — the import trail and the
// like — are refused: they are a record of what happened, and a record that can
// be edited afterwards is worth less than one that can't. `editedAt` is stamped
// so a changed note is visibly a changed note.
export async function updateBookingNote(
  bookingId: string,
  noteId: string,
  text: string
): Promise<"ok" | "not-found" | "protected" | "failed"> {
  if (!UUID_RE.test(bookingId)) return "not-found";
  try {
    const booking = await getBooking(bookingId);
    if (!booking) return "not-found";
    const notes = booking.notes ?? [];
    const target = notes.find((n) => n.id === noteId);
    if (!target) return "not-found";
    if (target.author === "System") return "protected";
    const next = notes.map((n) =>
      n.id === noteId ? { ...n, text: text.slice(0, 1000), editedAt: new Date().toISOString() } : n
    );
    const res = await rest(`bookings?id=eq.${bookingId}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ notes: next }),
    });
    if (!res.ok) {
      console.error("updating booking note failed:", await res.text().catch(() => ""));
      return "failed";
    }
    return "ok";
  } catch (err) {
    console.error("updating booking note failed:", err);
    return "failed";
  }
}

// Appends a note to a booking. Its own function for the same reason as
// saveGameResult below: the notes column only exists after the migration, so a
// pre-migration schema fails here alone rather than breaking the write that
// prompted the note. Never throws — a missing note must not sink a refund.
export async function addBookingNote(id: string, text: string, author = "System"): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  try {
    const booking = await getBooking(id);
    if (!booking) return false;
    const note: BookingNote = {
      id: randomUUID(),
      text: text.slice(0, 1000),
      at: new Date().toISOString(),
      author,
    };
    const res = await rest(`bookings?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ notes: [...(booking.notes ?? []), note] }),
    });
    if (!res.ok) {
      console.error("saving booking note failed:", await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("saving booking note failed:", err);
    return false;
  }
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
  if (b.status === "cancelled") return false;
  if (b.status !== "pending") return true;
  return b.pendingExpiresAt !== null && b.pendingExpiresAt > new Date().toISOString();
}

// Same test on a raw row, for queries that don't build full bookings.
function rowIsLive(status: string | null | undefined, pendingExpiresAt: string | null | undefined): boolean {
  const s = status ?? "paid";
  if (s === "cancelled") return false; // the seats go straight back on sale
  if (s !== "pending") return true;
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

// Spends the gift voucher a booking was checked out with, and reports how much
// actually came off it.
//
// Deliberately never throws: by the time this runs the customer's card has
// already been charged, so a voucher problem must not cost them the booking.
// If the balance moved between checkout and payment — the only realistic case
// being the same code used somewhere else in that window — we take whatever is
// left and the shortfall simply stays owing at the venue.
export async function takeVoucherFor(booking: Booking): Promise<number> {
  const p = booking.pricing;
  const code = p.voucherCode;
  const want = p.voucherCents ?? 0;
  if (!code || want <= 0 || p.voucherRedeemed) return p.voucherRedeemed ? want : 0;

  const first = booking.items[0];
  try {
    const result = await spendVoucher(code, want, {
      today: todayISO(),
      date: first?.date,
      time: first?.time,
      roomId: first?.roomId,
    });
    if (result.ok) return result.spentCents;
    console.error(`voucher ${code} could not be spent on ${booking.reference}: ${result.error}`);
    return 0;
  } catch (err) {
    console.error(`voucher ${code} could not be spent on ${booking.reference}:`, err);
    return 0;
  }
}

// Marks a pending Stripe booking as paid, recording what was actually charged.
// Idempotent — the webhook and the redirect-return can both call it.
export async function finalizeBookingPayment(
  id: string,
  paidCents: number,
  stripePaymentIntent?: string | null
): Promise<Booking | undefined> {
  const booking = await getBooking(id);
  if (!booking) return undefined;
  // This status check is what makes the whole thing idempotent: the webhook
  // and the return page race each other, and only the first one through here
  // gets as far as spending the voucher.
  if (booking.status === "paid") return booking;

  const voucherCents = await takeVoucherFor(booking);
  const settledCents = paidCents + voucherCents;
  const pricing: Booking["pricing"] = {
    ...booking.pricing,
    paidCents: settledCents,
    balanceCents: booking.pricing.totalCents - settledCents,
    voucherCents,
    voucherRedeemed: true,
    // remembered so a later cancellation can refund the right charge
    ...(stripePaymentIntent ? { stripePaymentIntent } : {}),
  };
  const res = await rest(`bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "paid", pending_expires_at: null, pricing }),
  });
  if (!res.ok) throw await restError(res, "Recording the payment");
  const paid: Booking = { ...booking, status: "paid", pendingExpiresAt: null, pricing };
  // Imported here rather than at the top: reward-flow reaches back into this
  // module, and a static cycle would leave one of them half-initialised.
  const { settleRewardsFor } = await import("./reward-flow");
  await settleRewardsFor(paid);
  return paid;
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

// Several bookings at once, for screens that hold a list of ids — one query
// instead of one per row.
export async function getBookingsByIds(ids: string[]): Promise<Map<string, Booking>> {
  const clean = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
  const out = new Map<string, Booking>();
  if (clean.length === 0) return out;
  const res = await rest(`bookings?id=in.(${clean.join(",")})&select=*`);
  if (!res.ok) throw await restError(res, "Loading those bookings");
  for (const row of (await res.json()) as BookingRow[]) out.set(row.id, toBooking(row));
  return out;
}

// Rewrites a booking's customer JSONB — used by the merge-customers tool to
// consolidate a typo'd identity onto the kept one. Participants are preserved
// by the caller (it spreads the existing customer object).
export async function updateBookingCustomer(id: string, customer: Booking["customer"]): Promise<void> {
  if (!UUID_RE.test(id)) throw new Error("Invalid booking id.");
  const res = await rest(`bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ customer }),
  });
  if (!res.ok) throw await restError(res, "Updating the booking's customer");
}

// Lookup by public reference (used by the feedback form to verify it's real).
export async function getBookingByReference(reference: string): Promise<Booking | undefined> {
  if (!/^VB-[A-Z0-9]{4,10}$/i.test(reference)) return undefined;
  const res = await rest(`bookings?reference=eq.${encodeURIComponent(reference.toUpperCase())}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Looking up the booking");
  const rows = (await res.json()) as BookingRow[];
  return rows[0] ? toBooking(rows[0]) : undefined;
}

// Every live booking, newest first (expired unpaid checkouts drop out).
// Live bookings only by default, so revenue, capacity and customer stats never
// count cancellations. The Bookings list passes includeCancelled so staff can
// still see them (and settle any refund).
//
// Paged, because PostgREST caps a plain select at 1000 rows: the history
// imported from the old system runs to thousands, and quietly stopping at 1000
// would drop bookings off the list, the customer roll-up and every report.
// `since` is a coarse prefilter on purchase date, so a screen showing the last
// 30 days doesn't drag six years of imported history across the wire. Callers
// still apply their own exact date test afterwards — pass a cutoff a little
// earlier than you need and let that do the precise work, because created_at is
// UTC while the screens reason in venue-local business dates.
export async function listBookings(opts?: {
  includeCancelled?: boolean;
  since?: string;
}): Promise<Booking[]> {
  // id breaks ties: created_at is not unique (imported sessions inherit the
  // legacy booked-on time, and several share one) and Postgres gives no stable
  // order within a tie, so paging would drop and duplicate rows.
  const since = opts?.since ? `&created_at=gte.${encodeURIComponent(opts.since)}` : "";
  const rows =
    (await restAllPages<BookingRow>(
      `bookings?select=*${since}&order=created_at.desc,id.desc`,
      "Loading bookings"
    )) ?? [];
  const all = rows.map(toBooking);
  if (opts?.includeCancelled) {
    // still drop lapsed pending checkouts — those were never real bookings
    return all.filter((b) => b.status === "cancelled" || isLiveBooking(b));
  }
  return all.filter(isLiveBooking);
}

// Bookings touching a date window — any session inside it, or the booking made
// inside it. Runs on the bookings_in_window function
// (scripts/bookings-in-window.sql) so a dashboard showing one day doesn't drag
// six years of imported history across the wire. Pass a day of slack each side
// and keep exact venue-local filtering in code. Returns null when the function
// isn't installed (or local-data mode) — callers fall back to listBookings().
export async function listBookingsInWindow(
  fromISO: string,
  toISO: string,
  opts?: { includeCancelled?: boolean }
): Promise<Booking[] | null> {
  let rows: BookingRow[] | null;
  try {
    rows = await restAllPages<BookingRow>(
      `rpc/bookings_in_window?p_from=${fromISO}&p_to=${toISO}&order=created_at.desc,id.desc`,
      "Loading bookings for the window"
    );
  } catch {
    return null; // local-data mode has no rpc endpoint
  }
  if (rows === null) return null; // function not installed yet
  const all = rows.map(toBooking);
  if (opts?.includeCancelled) {
    return all.filter((b) => b.status === "cancelled" || isLiveBooking(b));
  }
  return all.filter(isLiveBooking);
}

// One page of the Bookings tab, filtered, sorted and counted by the
// bookings_roster function (scripts/rapid-portal.sql) — so "All time" over six
// imported years returns 200 rows, not 29,000. Business-date bounds are
// venue-local days, converted inside Postgres with the same timezone the
// screens use. Returns null when the function isn't installed (or local-data
// mode); the page falls back to fetching and filtering in memory.
export async function bookingsRosterPage(opts: {
  q?: string;
  status: "all" | "active" | "noshow";
  pay: "all" | "paid" | "unpaid";
  date?: string | null;
  timezone: string;
  fromDay?: string | null;
  toDay?: string | null;
  since?: string | null;
  locations?: string[] | null;
  limit: number;
  offset: number;
}): Promise<{ total: number; rows: Booking[] } | null> {
  let res: Response;
  try {
    res = await rest("rpc/bookings_roster", {
      method: "POST",
      body: JSON.stringify({
        p_q: opts.q || null,
        p_status: opts.status,
        p_pay: opts.pay,
        p_date: opts.date || null,
        p_tz: opts.timezone,
        p_from_day: opts.fromDay || null,
        p_to_day: opts.toDay || null,
        p_since: opts.since || null,
        p_locations: opts.locations?.length ? opts.locations : null,
        p_limit: opts.limit,
        p_offset: opts.offset,
      }),
    });
  } catch {
    return null; // local-data mode has no rpc endpoint
  }
  if (res.status === 404) return null; // function not installed yet
  if (!res.ok) throw await restError(res, "Loading the bookings list");
  const rows = (await res.json()) as { total_rows: number; booking: BookingRow }[];
  return {
    total: rows[0] ? Number(rows[0].total_rows) : 0,
    rows: rows.map((r) => toBooking(r.booking)),
  };
}

// One customer's live bookings, newest first — for the profile page, which
// used to load every booking in the table and filter in memory. The ilike is a
// case-insensitive equality (its wildcards are escaped out of the address, and
// emails in bookings arrive in whatever casing the customer or the old system
// used); the exact re-check below keeps an escaped _ from ever over-matching.
export async function listBookingsForEmail(email: string): Promise<Booking[]> {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return [];
  const pattern = wanted.replace(/([\\%_])/g, "\\$1");
  const rows =
    (await restAllPages<BookingRow>(
      `bookings?select=*&customer->>email=ilike.${encodeURIComponent(pattern)}&order=created_at.desc,id.desc`,
      "Loading the customer's bookings"
    )) ?? [];
  return rows
    .map(toBooking)
    .filter((b) => b.customer.email.toLowerCase() === wanted)
    .filter(isLiveBooking);
}

// Cancels a booking: frees the slot, records what's owed back and whether
// Stripe already returned it. Refund figures live in the pricing JSONB.
export async function cancelBooking(
  id: string,
  refund: { owedCents: number; refundedCents: number }
): Promise<Booking | undefined> {
  if (!UUID_RE.test(id)) throw new Error("Invalid booking id.");
  const booking = await getBooking(id);
  if (!booking) return undefined;
  const pricing = {
    ...booking.pricing,
    refundOwedCents: refund.owedCents,
    refundedCents: refund.refundedCents,
    refundedAt: refund.refundedCents > 0 ? new Date().toISOString() : null,
  };
  const res = await rest(`bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "cancelled", pricing }),
  });
  if (!res.ok) throw await restError(res, "Cancelling the booking");
  return { ...booking, status: "cancelled", pricing };
}

// Moves a booking's sessions to a new date/time (same rooms, same prices).
export async function rescheduleBooking(id: string, items: Booking["items"]): Promise<void> {
  if (!UUID_RE.test(id)) throw new Error("Invalid booking id.");
  const res = await rest(`bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw await restError(res, "Rescheduling the booking");
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
