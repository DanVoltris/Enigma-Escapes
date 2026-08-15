// Booking requests: bookings that start within REQUEST_WINDOW_MINUTES go
// through manager approval instead of instant checkout. Accepted requests
// carry a token the customer uses to finish (details + payment) — see
// /request/[token] and the requestToken check in create-booking.
import { randomBytes, randomUUID } from "crypto";
import { minutesUntilSlot } from "./format";
import { rest, restError } from "./supabase";

// pending   — waiting on staff
// accepted  — staff said yes; the customer has been texted and must reply Y
// confirmed — customer replied Y; they turn up and pay in store
// declined / cancelled / expired / completed — done with, holds nothing
export type RequestStatus =
  | "pending"
  | "accepted"
  | "confirmed"
  | "declined"
  | "completed"
  | "cancelled"
  | "expired";

// A request holds its slot from the moment it arrives until it is dead. Staff
// approval and the customer's Y both take time, and in that time the slot must
// not be sellable to anyone else — the whole point of the hold.
export const HOLDING_STATUSES: RequestStatus[] = ["pending", "accepted", "confirmed"];

// How long the customer has to reply Y, and when they get nudged.
export const REPLY_REMINDER_MINUTES = 15;
export const REPLY_DEADLINE_MINUTES = 30;

export type BookingRequest = {
  id: string;
  createdAt: string;
  roomId: string;
  roomName: string;
  location: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  quantity: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  status: RequestStatus;
  token: string;
  decidedAt: string | null;
  bookingId: string | null;
  remindedAt: string | null;
};

type Row = {
  id: string; created_at: string; room_id: string; room_name: string; location: string;
  date: string; time: string; quantity: number; first_name: string; last_name: string;
  phone: string; email: string | null; status: string; token: string;
  decided_at: string | null; booking_id: string | null;
  reminded_at?: string | null;
};

function toRequest(r: Row): BookingRequest {
  const stored = ["pending", "accepted", "confirmed", "declined", "completed", "cancelled", "expired"].includes(
    r.status
  )
    ? (r.status as RequestStatus)
    : "pending";
  // A request whose slot has started is dead regardless of stored status
  // (unless it already became a booking or was declined).
  const status: RequestStatus =
    HOLDING_STATUSES.includes(stored) && minutesUntilSlot(r.date, r.time) <= 0 ? "expired" : stored;
  return {
    id: r.id, createdAt: r.created_at, roomId: r.room_id, roomName: r.room_name, location: r.location,
    date: r.date, time: r.time, quantity: r.quantity, firstName: r.first_name, lastName: r.last_name,
    phone: r.phone, email: r.email, status, token: r.token, decidedAt: r.decided_at, bookingId: r.booking_id,
    remindedAt: r.reminded_at ?? null,
  };
}

export async function createRequest(input: {
  roomId: string; roomName: string; location: string; date: string; time: string;
  quantity: number; firstName: string; lastName: string; phone: string; email: string | null;
}): Promise<BookingRequest> {
  const row: Row = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    room_id: input.roomId, room_name: input.roomName, location: input.location,
    date: input.date, time: input.time, quantity: input.quantity,
    first_name: input.firstName, last_name: input.lastName,
    phone: input.phone, email: input.email,
    status: "pending",
    token: randomBytes(24).toString("hex"),
    decided_at: null, booking_id: null, reminded_at: null,
  };
  const res = await rest("booking_requests", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw await restError(res, "Sending the booking request");
  return toRequest(row);
}

export async function listRequests(): Promise<BookingRequest[]> {
  const res = await rest("booking_requests?select=*&order=created_at.desc");
  if (res.status === 404) return []; // table not created yet
  if (!res.ok) throw await restError(res, "Loading booking requests");
  return ((await res.json()) as Row[]).map(toRequest);
}

export async function getRequestByToken(token: string): Promise<BookingRequest | undefined> {
  if (!/^[a-f0-9]{48}$/.test(token)) return undefined;
  const res = await rest(`booking_requests?token=eq.${token}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Loading the booking request");
  const rows = (await res.json()) as Row[];
  return rows[0] ? toRequest(rows[0]) : undefined;
}

export async function getRequestById(id: string): Promise<BookingRequest | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
  const res = await rest(`booking_requests?id=eq.${id}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Loading the booking request");
  const rows = (await res.json()) as Row[];
  return rows[0] ? toRequest(rows[0]) : undefined;
}

export async function setRequestStatus(
  id: string,
  status: RequestStatus,
  bookingId?: string
): Promise<void> {
  const patch: Record<string, unknown> = { status, decided_at: new Date().toISOString() };
  if (bookingId) patch.booking_id = bookingId;
  const res = await rest(`booking_requests?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await restError(res, "Updating the booking request");
}

// Slots held by a live request, keyed "roomId|time", with how many seats each
// holds. Availability subtracts these so a slot someone is mid-request for
// can't be sold underneath them — and so a second customer can't request it
// either. Expired rows are ignored by the same rule toRequest applies.
export async function heldSeatsForDate(date: string): Promise<Map<string, number>> {
  const held = new Map<string, number>();
  try {
    const statuses = HOLDING_STATUSES.join(",");
    const res = await rest(
      `booking_requests?select=room_id,time,quantity,status,date&date=eq.${encodeURIComponent(date)}` +
        `&status=in.(${statuses})`
    );
    if (!res.ok) return held;
    for (const r of (await res.json()) as Row[]) {
      if (minutesUntilSlot(r.date, r.time) <= 0) continue; // dead, holds nothing
      const key = `${r.room_id}|${r.time}`;
      held.set(key, (held.get(key) ?? 0) + r.quantity);
    }
  } catch (err) {
    console.error("loading held slots failed:", err); // never block availability on this
  }
  return held;
}

// The same for one slot, for the checks that only care about one.
export async function heldSeats(roomId: string, date: string, time: string): Promise<number> {
  return (await heldSeatsForDate(date)).get(`${roomId}|${time}`) ?? 0;
}

// Requests whose customer has been asked to reply and hasn't yet — the sweep
// reads this to send reminders and to cancel the ones that ran out of time.
export async function requestsAwaitingReply(): Promise<BookingRequest[]> {
  const res = await rest(`booking_requests?select=*&status=eq.accepted&order=decided_at.asc`);
  if (!res.ok) return [];
  return ((await res.json()) as Row[]).map(toRequest).filter((r) => r.status === "accepted");
}

// The newest live request for a phone number — how an inbound "Y" finds what
// it is answering, since a text carries nothing but the number it came from.
export async function latestRequestForPhone(phone: string): Promise<BookingRequest | undefined> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return undefined;
  const res = await rest(`booking_requests?select=*&phone=like.*${digits}&order=created_at.desc&limit=5`);
  if (!res.ok) return undefined;
  const rows = ((await res.json()) as Row[]).map(toRequest);
  return rows.find((r) => r.status === "accepted") ?? rows.find((r) => r.status === "confirmed");
}

// Stamps when the reminder went out, so the sweep never sends it twice.
// Returns false if it couldn't be stamped — including when the column doesn't
// exist yet. The caller stamps BEFORE texting, so a database that can't
// remember having reminded someone sends nothing at all, rather than the same
// nudge every five minutes until their slot lapses.
export async function markReminded(id: string): Promise<boolean> {
  try {
    const res = await rest(`booking_requests?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ reminded_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      console.error("marking a request reminded failed:", await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("marking a request reminded failed:", err);
    return false;
  }
}
