import { randomUUID } from "crypto";
import { minutesOfTime, type BusySession } from "./capacity";
import { todayISO } from "./format";
import { refundPayment } from "./stripe";
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
  // Added later, so rows written before the column existed read as undefined.
  booked_by?: string | null;
  attribution?: Booking["attribution"];
};

function toBooking(row: BookingRow): Booking {
  const status = row.status === "pending" || row.status === "cancelled" ? row.status : "paid";
  return {
    id: row.id,
    reference: row.reference,
    createdAt: row.created_at,
    customer: row.customer,
    items: row.items,
    promoCode: row.promo_code,
    paymentOption: row.payment_option,
    // A cancelled booking owes nothing — whatever was outstanding died with it,
    // and a balance sitting there reads as money to chase. Normalised on the way
    // out as well as written on cancellation, so bookings cancelled before that
    // was true read correctly too. Money already taken is a refund question and
    // lives in refundOwedCents/refundedCents.
    pricing: status === "cancelled" ? { ...row.pricing, balanceCents: 0 } : row.pricing,
    source: row.source ?? "online",
    noShow: row.no_show ?? false,
    status,
    pendingExpiresAt: row.pending_expires_at ?? null,
    gameResult: row.game_result ?? null,
    notes: row.notes ?? [],
    bookedBy: row.booked_by ?? null,
    attribution: row.attribution ?? null,
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
    // Same reason: only written when there is something to write, so the column
    // being absent can't break an online booking.
    ...(booking.bookedBy ? { booked_by: booking.bookedBy } : {}),
    ...(booking.attribution ? { attribution: booking.attribution } : {}),
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

// Records what came off the voucher on a booking already claimed as paid. The
// money has left the voucher by now, so a failed save is retried rather than
// thrown: throwing would make Stripe retry, find the booking paid, and leave it
// showing the voucher's share as still owed. If it still fails, say exactly
// what to correct.
async function saveVoucherTaken(booking: Booking, pricing: Booking["pricing"]): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await rest(`bookings?id=eq.${booking.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ pricing }),
    });
    if (res.ok) return;
    if (attempt === 2) {
      console.error(
        `${booking.reference}: $${((pricing.voucherCents ?? 0) / 100).toFixed(2)} was taken from voucher ` +
          `${pricing.voucherCode} but the booking could not be updated (${await restError(res, "Saving")}). ` +
          `Its balance should be $${(pricing.balanceCents / 100).toFixed(2)}.`
      );
    }
  }
}

// Payment arrived for a booking that was cancelled while its Stripe page was
// still open. Its slot went back on sale at the cancellation, so the booking
// stays cancelled and the money goes straight back to the card. The refund is
// recorded on the booking (owed, and refunded if Stripe took it), so a refund
// Stripe refused shows as "Refund owed" for staff rather than vanishing.
// Keyed on the payment intent, so Stripe retrying the webhook, or the return
// page landing too, neither refunds nor records it twice.
async function refundLatePayment(
  booking: Booking,
  paidCents: number,
  intent: string | null | undefined
): Promise<Booking> {
  if (!intent || paidCents <= 0 || booking.pricing.stripePaymentIntent === intent) return booking;
  let refundedCents = 0;
  try {
    refundedCents = (await refundPayment(intent, paidCents, `late-payment-refund-${intent}`)) ?? 0;
  } catch (err) {
    console.error(`refunding the late payment on cancelled ${booking.reference} failed:`, err);
  }
  const pricing: Booking["pricing"] = {
    ...booking.pricing,
    stripePaymentIntent: intent,
    refundOwedCents: (booking.pricing.refundOwedCents ?? 0) + paidCents,
    refundedCents: (booking.pricing.refundedCents ?? 0) + refundedCents,
    refundedAt: refundedCents > 0 ? new Date().toISOString() : (booking.pricing.refundedAt ?? null),
  };
  await updateBookingFields(booking.id, { pricing });
  const amount = `$${(paidCents / 100).toFixed(2)}`;
  const what =
    refundedCents >= paidCents
      ? `refunded to the card automatically`
      : `Stripe did not take the refund — refund payment ${intent} by hand`;
  await addBookingNote(booking.id, `${amount} was paid online after this booking was cancelled — ${what}.`);
  await logActivity("Payment on a cancelled booking", `${booking.reference} — ${amount} ${what}`);
  return { ...booking, pricing };
}

// Marks a pending Stripe booking as paid, recording what was actually charged.
// Idempotent — the webhook and the redirect-return can both call it.
//
// `justPaid` is true for exactly one caller: the one whose save moved the
// booking to paid. That caller sends the confirmation text and the staff
// alerts, so they go out once whichever path gets there first — before this,
// only the webhook sent them, and a customer returning faster than the webhook
// meant nobody was told at all.
export async function finalizeBookingPayment(
  id: string,
  paidCents: number,
  stripePaymentIntent?: string | null
): Promise<{ booking: Booking; justPaid: boolean } | undefined> {
  const booking = await getBooking(id);
  if (!booking) return undefined;
  if (booking.status === "paid") return { booking, justPaid: false };
  if (booking.status === "cancelled") {
    return { booking: await refundLatePayment(booking, paidCents, stripePaymentIntent), justPaid: false };
  }

  // Claim first, spend second. The webhook and the return page often arrive
  // together and both get past the check above; this save only matches a
  // booking that isn't paid yet, so exactly one of them moves it, and only that
  // one goes on to take the gift voucher. (Spending before claiming let both
  // take it: a $50 voucher share came off the balance twice.)
  //
  // The claim records the card payment alone. If anything stops between here
  // and the voucher being taken, the booking reads paid by card with the
  // voucher's share still owed at the venue, and the voucher keeps its balance:
  // the customer is never charged twice, they just pay that share in person.
  const cardPaid: Booking["pricing"] = {
    ...booking.pricing,
    paidCents,
    balanceCents: booking.pricing.totalCents - paidCents,
    voucherRedeemed: false,
    // remembered so a later cancellation can refund the right charge
    ...(stripePaymentIntent ? { stripePaymentIntent } : {}),
  };
  // Only a booking still pending can be claimed. "Not paid" also matched a
  // cancelled one, so a customer finishing the Stripe page after staff had
  // cancelled their checkout un-cancelled it, on top of whoever had since
  // bought the slot.
  const claim = await rest(`bookings?id=eq.${id}&status=eq.pending`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "paid", pending_expires_at: null, pricing: cardPaid }),
  });
  if (!claim.ok) throw await restError(claim, "Recording the payment");
  if (((await claim.json()) as unknown[]).length === 0) {
    const now = (await getBooking(id)) ?? booking;
    // Cancelled between the read above and the claim.
    if (now.status === "cancelled") {
      return { booking: await refundLatePayment(now, paidCents, stripePaymentIntent), justPaid: false };
    }
    return { booking: now, justPaid: false };
  }

  let pricing = cardPaid;
  const voucherCents = await takeVoucherFor(booking);
  if (voucherCents > 0) {
    const settledCents = paidCents + voucherCents;
    pricing = {
      ...cardPaid,
      paidCents: settledCents,
      balanceCents: booking.pricing.totalCents - settledCents,
      voucherCents,
      voucherRedeemed: true,
    };
    await saveVoucherTaken(booking, pricing);
  } else if (booking.pricing.voucherCode && (booking.pricing.voucherCents ?? 0) > 0) {
    // Nothing could be taken (emptied or expired since checkout): the voucher's
    // share stays on the balance rather than being recorded as paid.
    pricing = { ...cardPaid, voucherCents: 0 };
    await saveVoucherTaken(booking, pricing);
  }
  const paid: Booking = { ...booking, status: "paid", pendingExpiresAt: null, pricing };
  // Imported here rather than at the top: reward-flow reaches back into this
  // module, and a static cycle would leave one of them half-initialised.
  const { settleRewardsFor } = await import("./reward-flow");
  await settleRewardsFor(paid);
  return { booking: paid, justPaid: true };
}

// Lets go of an unpaid checkout's spots now rather than when its hold lapses —
// the customer backed out of Stripe's page and is paying again, or the Stripe
// session was never made. The row stays as a lapsed checkout, exactly as if the
// hold had run out. Only matches a booking still pending, so it can never undo
// a payment. Callers must make sure the old Stripe session can't be paid first.
export async function releasePendingBooking(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const res = await rest(`bookings?id=eq.${id}&status=eq.pending`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ pending_expires_at: new Date(Date.now() - 1000).toISOString() }),
  });
  if (!res.ok) throw await restError(res, "Releasing the held spots");
  return ((await res.json()) as unknown[]).length > 0;
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

// The same correction across every live booking that carries the old address —
// a typo is rarely on just one of them, and leaving the rest behind splits one
// person into two customer profiles. Reuses the rewrite the merge tool uses.
export async function updateCustomerAcrossBookings(
  oldEmail: string,
  patch: { firstName: string; lastName: string; email: string; phone: string }
): Promise<{ changed: number; failed: string[] }> {
  const bookings = await listBookingsForEmail(oldEmail);
  let changed = 0;
  const failed: string[] = [];
  for (const b of bookings) {
    try {
      // Spread first so participants and the marketing preference survive.
      await updateBookingCustomer(b.id, { ...b.customer, ...patch });
      changed++;
    } catch (err) {
      console.error(`updating contact details on ${b.reference} failed:`, err);
      failed.push(b.reference);
    }
  }
  return { changed, failed };
}

// Cancels a booking: frees the slot, records what's owed back and whether
// Stripe already returned it. Refund figures live in the pricing JSONB.
//
// They are added to what the booking already carries, not written over it: a
// refund made from the Refund panel before the cancellation stays on record,
// and the cancellation adds only its own. What Stripe returned here came off
// the checkout payment, so it counts against that payment as well.
export async function cancelBooking(
  id: string,
  refund: { owedCents: number; refundedCents: number }
): Promise<Booking | undefined> {
  if (!UUID_RE.test(id)) throw new Error("Invalid booking id.");
  const booking = await getBooking(id);
  if (!booking) return undefined;
  const pricing = {
    ...booking.pricing,
    // Nobody owes anything on a cancelled booking. Cleared here as well as on
    // read so the database itself is right — the bookings list's paid/unpaid
    // filter runs in SQL against this figure.
    balanceCents: 0,
    refundOwedCents: (booking.pricing.refundOwedCents ?? 0) + refund.owedCents,
    refundedCents: (booking.pricing.refundedCents ?? 0) + refund.refundedCents,
    ...(refund.refundedCents > 0
      ? { onlineRefundedCents: (booking.pricing.onlineRefundedCents ?? 0) + refund.refundedCents }
      : {}),
    refundedAt: refund.refundedCents > 0 ? new Date().toISOString() : (booking.pricing.refundedAt ?? null),
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

// Party size changed by staff: the item and the re-figured money go together,
// so a failure can't leave a booking for six people priced for four.
export async function updateBookingPartySize(
  id: string,
  items: Booking["items"],
  pricing: Booking["pricing"]
): Promise<void> {
  if (!UUID_RE.test(id)) throw new Error("Invalid booking id.");
  const res = await rest(`bookings?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ items, pricing }),
  });
  if (!res.ok) throw await restError(res, "Changing the party size");
}

// All booked spot counts for one date, keyed "roomId|time". One query per date
// (the availability page needs every slot) using a jsonb contains filter.
// Live pending checkouts count — their spots are held until they expire.
// Everything live booked into one room on one date. Used before changing a
// day's start times: a time that has a booking must not be taken off the list,
// or the group's session disappears from the grid with nothing to explain it.
export async function bookingsForRoomOnDate(roomId: string, date: string): Promise<Booking[]> {
  const filter = encodeURIComponent(JSON.stringify([{ roomId, date }]));
  const res = await rest(`bookings?select=*&items=cs.${filter}`);
  if (!res.ok) throw await restError(res, "Loading that day's bookings");
  return ((await res.json()) as BookingRow[]).map(toBooking).filter(isLiveBooking);
}

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

// Every live session running in each room on a date, as intervals, so a slot
// can be checked against the games either side of it and not just the one that
// starts at the same minute. Keyed by roomId.
//
// Each session's own stored duration is used, not the room's current one: a
// booking sold when the game ran 75 minutes still occupies 75.
export async function busySessionsForDate(date: string): Promise<Map<string, BusySession[]>> {
  const filter = encodeURIComponent(JSON.stringify([{ date }]));
  const res = await rest(`bookings?select=items,status,pending_expires_at&items=cs.${filter}`);
  if (!res.ok) throw await restError(res, "Loading the day's sessions");
  const rows = (await res.json()) as Pick<BookingRow, "items" | "status" | "pending_expires_at">[];
  const busy = new Map<string, BusySession[]>();
  for (const row of rows) {
    if (!rowIsLive(row.status, row.pending_expires_at)) continue;
    for (const item of row.items) {
      if (item.date !== date) continue;
      const start = minutesOfTime(item.time);
      const list = busy.get(item.roomId) ?? [];
      const existing = list.find((s) => s.start === start);
      if (existing) existing.guests += item.quantity;
      else list.push({ time: item.time, start, end: start + item.durationMinutes, guests: item.quantity });
      busy.set(item.roomId, list);
    }
  }
  return busy;
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

// staff_only was added after the table: rows written before it read as
// undefined, which means the same as false.
type PromoRow = { code: string; percent_off: number; active: boolean; staff_only?: boolean | null };

function toPromo(r: PromoRow): Promo {
  return { code: r.code, percentOff: r.percent_off, active: r.active, staffOnly: r.staff_only === true };
}

export async function getPromo(code: string): Promise<Promo | undefined> {
  const res = await rest(`promo_codes?code=eq.${encodeURIComponent(code)}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Checking the promo code");
  const rows = (await res.json()) as PromoRow[];
  return rows[0] ? toPromo(rows[0]) : undefined;
}

export async function listPromos(): Promise<Promo[]> {
  const res = await rest("promo_codes?select=*&order=code.asc");
  if (!res.ok) throw await restError(res, "Loading promo codes");
  return ((await res.json()) as PromoRow[]).map(toPromo);
}

export async function createPromo(promo: Promo): Promise<void> {
  const res = await rest("promo_codes", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    // The column is only sent when it matters, so ordinary codes keep working
    // on a database that hasn't had the staff_only column added yet.
    body: JSON.stringify({
      code: promo.code,
      percent_off: promo.percentOff,
      active: promo.active,
      ...(promo.staffOnly ? { staff_only: true } : {}),
    }),
  });
  if (!res.ok) throw await restError(res, "Creating the promo code");
}

export async function updatePromo(
  code: string,
  patch: { percentOff?: number; active?: boolean; staffOnly?: boolean }
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.percentOff !== undefined) row.percent_off = patch.percentOff;
  if (patch.active !== undefined) row.active = patch.active;
  if (patch.staffOnly !== undefined) row.staff_only = patch.staffOnly;
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
