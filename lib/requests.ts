// Booking requests: bookings that start within REQUEST_WINDOW_MINUTES go
// through manager approval instead of instant checkout. Accepted requests
// carry a token the customer uses to finish (details + payment) — see
// /request/[token] and the requestToken check in create-booking.
import { randomBytes, randomUUID } from "crypto";
import { minutesUntilSlot } from "./format";
import { rest, restError } from "./supabase";

export type RequestStatus = "pending" | "accepted" | "declined" | "completed" | "expired";

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
};

type Row = {
  id: string; created_at: string; room_id: string; room_name: string; location: string;
  date: string; time: string; quantity: number; first_name: string; last_name: string;
  phone: string; email: string | null; status: string; token: string;
  decided_at: string | null; booking_id: string | null;
};

function toRequest(r: Row): BookingRequest {
  const stored = ["pending", "accepted", "declined", "completed", "expired"].includes(r.status)
    ? (r.status as RequestStatus)
    : "pending";
  // A request whose slot has started is dead regardless of stored status
  // (unless it already became a booking or was declined).
  const status: RequestStatus =
    (stored === "pending" || stored === "accepted") && minutesUntilSlot(r.date, r.time) <= 0 ? "expired" : stored;
  return {
    id: r.id, createdAt: r.created_at, roomId: r.room_id, roomName: r.room_name, location: r.location,
    date: r.date, time: r.time, quantity: r.quantity, firstName: r.first_name, lastName: r.last_name,
    phone: r.phone, email: r.email, status, token: r.token, decidedAt: r.decided_at, bookingId: r.booking_id,
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
    decided_at: null, booking_id: null,
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
