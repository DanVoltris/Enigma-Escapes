import { businessDateOf, businessWeekdayOf } from "./format";
import type { Booking } from "./types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type PeriodInsights = {
  bookings: number;
  guests: number;
  grossCents: number; // ticket price × guests, before discount/tax
  discountCents: number;
  gstCents: number;
  totalCents: number; // billed, incl. GST
  collectedCents: number; // paid online so far (full or deposit)
  outstandingCents: number; // balance due at venue
  depositBookings: number;
  fullBookings: number;
  onlineBookings: number;
  inPersonBookings: number;
  noShowBookings: number;
  noShowGuests: number;
  avgPerBookingCents: number;
  avgGuestsPerBooking: number;
  byWeekday: { weekday: string; totalCents: number; bookings: number }[];
  byExperience: { name: string; guests: number; grossCents: number; sessions: number }[];
};

// Aggregates bookings PLACED within [fromISO, toISO] (venue-local dates,
// inclusive), keyed off when the booking was made. Complementary to the Reports
// page, which aggregates by when sessions run.
export function computeInsights(bookings: Booking[], fromISO: string, toISO: string): PeriodInsights {
  const inRange = bookings.filter((b) => {
    const d = businessDateOf(b.createdAt);
    return d >= fromISO && d <= toISO;
  });

  const weekday = new Map<string, { totalCents: number; bookings: number }>();
  const experience = new Map<string, { guests: number; grossCents: number; sessions: number }>();

  let guests = 0;
  let grossCents = 0;
  let discountCents = 0;
  let gstCents = 0;
  let totalCents = 0;
  let collectedCents = 0;
  let outstandingCents = 0;
  let depositBookings = 0;
  let fullBookings = 0;
  let onlineBookings = 0;
  let inPersonBookings = 0;
  let noShowBookings = 0;
  let noShowGuests = 0;

  for (const b of inRange) {
    const bookingGuests = b.items.reduce((s, i) => s + i.quantity, 0);
    guests += bookingGuests;
    grossCents += b.pricing.subtotalCents;
    discountCents += b.pricing.discountCents;
    gstCents += b.pricing.gstCents;
    totalCents += b.pricing.totalCents;
    collectedCents += b.pricing.paidCents;
    outstandingCents += b.pricing.balanceCents;
    // A walk-in with nothing taken is neither: it counts in outstanding money
    // above, and inflating either bucket here would misreport how people pay.
    if (b.paymentOption === "deposit") depositBookings += 1;
    else if (b.paymentOption === "full") fullBookings += 1;
    if (b.source === "in_person") inPersonBookings += 1;
    else onlineBookings += 1;
    if (b.noShow) {
      noShowBookings += 1;
      noShowGuests += bookingGuests;
    }

    const wd = businessWeekdayOf(b.createdAt);
    const w = weekday.get(wd) ?? { totalCents: 0, bookings: 0 };
    w.totalCents += b.pricing.totalCents;
    w.bookings += 1;
    weekday.set(wd, w);

    for (const item of b.items) {
      const e = experience.get(item.roomName) ?? { guests: 0, grossCents: 0, sessions: 0 };
      e.guests += item.quantity;
      e.grossCents += item.priceCents * item.quantity;
      e.sessions += 1; // one item = one booked session of this room
      experience.set(item.roomName, e);
    }
  }

  const bookingsCount = inRange.length;

  return {
    bookings: bookingsCount,
    guests,
    grossCents,
    discountCents,
    gstCents,
    totalCents,
    collectedCents,
    outstandingCents,
    depositBookings,
    fullBookings,
    onlineBookings,
    inPersonBookings,
    noShowBookings,
    noShowGuests,
    avgPerBookingCents: bookingsCount ? Math.round(totalCents / bookingsCount) : 0,
    avgGuestsPerBooking: bookingsCount ? guests / bookingsCount : 0,
    byWeekday: WEEKDAYS.map((wd) => ({
      weekday: wd,
      totalCents: weekday.get(wd)?.totalCents ?? 0,
      bookings: weekday.get(wd)?.bookings ?? 0,
    })),
    byExperience: Array.from(experience.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.guests - a.guests),
  };
}

// Share of all-time customers (by email) who have booked more than once.
export function repeatCustomerRate(bookings: Booking[]): { rate: number; repeat: number; total: number } {
  const counts = new Map<string, number>();
  for (const b of bookings) {
    const key = b.customer.email.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = counts.size;
  const repeat = Array.from(counts.values()).filter((n) => n > 1).length;
  return { rate: total ? repeat / total : 0, repeat, total };
}

export function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}
