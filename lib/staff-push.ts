// What each staff phone notification says. Room, location, time and party
// size — never the customer's name or number: lock screens get read by whoever
// is standing next to the phone. Tapping one opens the page to act on it.
//
// Every function here returns straight away and sends after the response
// (pushLater), so nobody waits on Apple or Google, and none can throw.
import { formatDateLong, formatTime, todayISO } from "./format";
import { pushLater, pushToStaff } from "./push";
import type { BookingRequest } from "./requests";
import type { Booking, CartItem } from "./types";

function when(date: string, time: string): string {
  return date === todayISO() ? `today ${formatTime(time)}` : `${formatDateLong(date)} ${formatTime(time)}`;
}

const guests = (n: number) => `${n} guest${n === 1 ? "" : "s"}`;

// A request is only ever for a session a few hours away; after that the alert
// is noise, so Apple and Google needn't keep trying a phone that's switched off.
const REQUEST_TTL = 4 * 3600;

type RequestLike = Pick<BookingRequest, "id" | "roomName" | "location" | "date" | "time" | "quantity">;

export function pushNewRequest(r: RequestLike, origin?: string): void {
  pushLater(() =>
    pushToStaff({
      event: "request.new",
      locations: [r.location],
      title: "New booking request",
      body: `${r.roomName} (${r.location}), ${when(r.date, r.time)}, ${guests(r.quantity)}. Accept or decline it.`,
      url: "/manager/requests",
      tag: `request-${r.id}`,
      ttlSeconds: REQUEST_TTL,
      urgent: true,
      origin,
    })
  );
}

export function pushRequestConfirmed(r: RequestLike, by?: string, origin?: string): void {
  pushLater(() =>
    pushToStaff({
      event: "request.confirmed",
      locations: [r.location],
      title: "Request confirmed",
      body:
        `${r.roomName} (${r.location}), ${when(r.date, r.time)}, ${guests(r.quantity)}: ` +
        (by ? `confirmed at the desk by ${by}.` : "the customer replied Y."),
      url: "/manager/requests",
      tag: `request-${r.id}`,
      ttlSeconds: REQUEST_TTL,
      origin,
    })
  );
}

export function pushRequestReleased(r: RequestLike, reason: "declined-by-customer" | "no-reply", origin?: string): void {
  pushLater(() =>
    pushToStaff({
      event: "request.released",
      locations: [r.location],
      title: "Request released",
      body:
        `${r.roomName} (${r.location}), ${when(r.date, r.time)}: ` +
        (reason === "no-reply" ? "no reply in time, so it's back on sale." : "the customer replied N, so it's back on sale."),
      url: "/manager/requests",
      tag: `request-${r.id}`,
      ttlSeconds: REQUEST_TTL,
      origin,
    })
  );
}

function sessions(items: CartItem[]): string {
  const first = items[0];
  if (!first) return "";
  const more = items.length > 1 ? ` (+${items.length - 1} more)` : "";
  return `${first.roomName} (${first.location}), ${when(first.date, first.time)}, ${guests(first.quantity)}${more}`;
}

const bookingUrl = (b: Booking) => `/manager/bookings/${b.id}`;
const locationsOf = (items: CartItem[]) => [...new Set(items.map((i) => i.location))];

export function pushBookingCancelled(b: Booking, origin?: string): void {
  pushLater(() =>
    pushToStaff({
      event: "booking.cancelled",
      locations: locationsOf(b.items),
      title: "Booking cancelled",
      body: `${b.reference}: ${sessions(b.items)}. Cancelled by the customer.`,
      url: bookingUrl(b),
      tag: `booking-${b.id}`,
      origin,
    })
  );
}

// `before` is the booking as it was, so staff see where it moved from.
export function pushBookingRescheduled(before: Booking, moved: CartItem, origin?: string): void {
  const was = before.items[0];
  pushLater(() =>
    pushToStaff({
      event: "booking.rescheduled",
      locations: locationsOf([...before.items, moved]),
      title: "Booking moved",
      body:
        `${before.reference}: ${moved.roomName} (${moved.location}) moved to ${when(moved.date, moved.time)}` +
        (was ? `, was ${when(was.date, was.time)}.` : "."),
      url: bookingUrl(before),
      tag: `booking-${before.id}`,
      origin,
    })
  );
}

export function pushOnlineBooking(b: Booking, origin?: string): void {
  pushLater(() =>
    pushToStaff({
      event: "booking.new",
      locations: locationsOf(b.items),
      title: "New online booking",
      body: `${b.reference}: ${sessions(b.items)}.`,
      url: bookingUrl(b),
      tag: `booking-${b.id}`,
      origin,
    })
  );
}

// Not sent to whoever took it: they're standing at the desk.
export function pushWalkIn(b: Booking, takenBy: { id: string; name: string }, origin?: string): void {
  pushLater(() =>
    pushToStaff({
      event: "booking.walkin",
      locations: locationsOf(b.items),
      exceptStaffId: takenBy.id,
      title: "Walk-in booked",
      body: `${b.reference}: ${sessions(b.items)}. Taken by ${takenBy.name}.`,
      url: bookingUrl(b),
      tag: `booking-${b.id}`,
      origin,
    })
  );
}
