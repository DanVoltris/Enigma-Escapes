import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { slotRemaining } from "@/lib/availability";
import { saveBooking } from "@/lib/db";
import { addDaysISO, formatTime, isValidISODate, todayISO } from "@/lib/format";
import { amountDueCents, BOOKING_WINDOW_DAYS, computeTotals, PROMO_CODES } from "@/lib/pricing";
import { getRoom } from "@/lib/rooms";
import type { Booking, CartItem, Customer, PaymentOption } from "@/lib/types";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function cleanString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) return null;
  return trimmed;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("Request body must be valid JSON.");
  }
  const data = body as {
    items?: unknown;
    customer?: Partial<Customer>;
    paymentOption?: unknown;
    promoCode?: unknown;
  };

  // --- customer ---
  const firstName = cleanString(data.customer?.firstName, 100);
  const lastName = cleanString(data.customer?.lastName, 100);
  const email = cleanString(data.customer?.email, 200);
  const phone = cleanString(data.customer?.phone, 30);
  if (!firstName) return bad("First name is required.");
  if (!lastName) return bad("Last name is required.");
  if (!email || !EMAIL_RE.test(email)) return bad("A valid email address is required.");
  if (!phone || !/^[\d\s()+-]{7,}$/.test(phone)) return bad("A valid phone number is required.");
  const customer: Customer = {
    firstName,
    lastName,
    email,
    phone,
    subscribe: data.customer?.subscribe === true,
  };

  // --- payment option / promo ---
  const paymentOption = data.paymentOption as PaymentOption;
  if (paymentOption !== "full" && paymentOption !== "deposit") {
    return bad("Choose whether to pay the full balance or the deposit.");
  }
  let promoCode: string | null = null;
  if (data.promoCode != null && data.promoCode !== "") {
    const code = cleanString(data.promoCode, 40)?.toUpperCase();
    if (!code || !(code in PROMO_CODES)) {
      return bad("That promo code is not valid. Remove it or enter a different code.");
    }
    promoCode = code;
  }

  // --- items ---
  if (!Array.isArray(data.items) || data.items.length === 0) {
    return bad("Your cart is empty. Add a booking before checking out.");
  }
  const today = todayISO();
  const lastBookable = addDaysISO(today, BOOKING_WINDOW_DAYS);
  const items: CartItem[] = [];
  try {
    for (const raw of data.items as Partial<CartItem>[]) {
      const room = typeof raw.roomId === "string" ? getRoom(raw.roomId) : undefined;
      if (!room) return bad("One of your bookings refers to an unknown experience.");
      const date = typeof raw.date === "string" ? raw.date : "";
      const time = typeof raw.time === "string" ? raw.time : "";
      if (!isValidISODate(date) || date < today || date > lastBookable) {
        return bad(`${room.name}: that date can no longer be booked.`);
      }
      const quantity = raw.quantity;
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > room.capacity) {
        return bad(`${room.name}: quantity must be between 1 and ${room.capacity}.`);
      }
      const remaining = await slotRemaining(room.id, date, time);
      if (remaining === null) return bad(`${room.name}: that time slot does not exist.`);
      if (remaining < quantity) {
        return bad(
          `${room.name} at ${formatTime(time)} only has ${remaining} spot(s) left. Reduce the quantity or pick another time.`
        );
      }
      items.push({
        roomId: room.id,
        roomName: room.name,
        location: room.location,
        date,
        time,
        quantity,
        priceCents: room.priceCents, // price always from the catalog, never from the client
        durationMinutes: room.durationMinutes,
      });
    }
  } catch (err) {
    console.error("availability check failed:", err);
    return NextResponse.json(
      { error: "Could not verify availability right now. Please try again shortly." },
      { status: 500 }
    );
  }

  // --- totals (recomputed server-side; client numbers are never trusted) ---
  const totals = computeTotals(items, promoCode);
  const paidCents = amountDueCents(totals, paymentOption);

  const id = randomUUID();
  const booking: Booking = {
    id,
    reference: `VB-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    customer,
    items,
    promoCode,
    paymentOption,
    pricing: {
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      gstCents: totals.gstCents,
      totalCents: totals.totalCents,
      paidCents,
      balanceCents: totals.totalCents - paidCents,
    },
  };

  try {
    await saveBooking(booking);
  } catch (err) {
    console.error("saving booking failed:", err);
    return NextResponse.json(
      { error: "Could not save your booking right now. You have not been charged — please try again shortly." },
      { status: 500 }
    );
  }
  return NextResponse.json({ id: booking.id, reference: booking.reference }, { status: 201 });
}
