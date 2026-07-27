import { randomUUID } from "crypto";
import { maxPerBooking, minPerBooking, remainingSpots } from "./capacity";
import { bookedCountsForDate, getPromo } from "./db";
import { getExperience } from "./experiences";
import { addDaysISO, formatTime, isValidISODate, todayISO } from "./format";
import { getLocationHours } from "./hours";
import { startTimesFor } from "./schedule";
import { activeTaxPercent } from "./taxes";
import { amountDueCents, computeTotals } from "./pricing";
import { getSiteSettings } from "./site-settings";
import type { Booking, BookingSource, CartItem, Customer } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type BuildResult = { booking: Booking } | { error: string; status: number };

function cleanString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) return null;
  return trimmed;
}

type RawInput = {
  items?: unknown;
  customer?: Partial<Customer>;
  paymentOption?: unknown;
  promoCode?: unknown;
};

// Validates input against live catalog + availability and builds a Booking.
// Shared by the public checkout (source "online") and the staff walk-in form
// (source "in_person"). Prices, promo, and availability are always taken from
// the database — never trusted from the caller.
export async function buildBooking(raw: RawInput, source: BookingSource): Promise<BuildResult> {
  const err = (error: string): BuildResult => ({ error, status: 400 });

  const firstName = cleanString(raw.customer?.firstName, 100);
  const lastName = cleanString(raw.customer?.lastName, 100);
  const email = cleanString(raw.customer?.email, 200);
  const phone = cleanString(raw.customer?.phone, 30);
  if (!firstName) return err("First name is required.");
  if (!lastName) return err("Last name is required.");
  if (!email || !EMAIL_RE.test(email)) return err("A valid email address is required.");
  if (!phone || !/^[\d\s()+-]{7,}$/.test(phone)) return err("A valid phone number is required.");
  const customer: Customer = { firstName, lastName, email, phone, subscribe: raw.customer?.subscribe === true };

  const paymentOption = raw.paymentOption;
  if (paymentOption !== "full" && paymentOption !== "deposit") {
    return err("Choose whether to pay the full balance or the deposit.");
  }

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    return err("Add at least one session before booking.");
  }

  const today = todayISO();
  const lastBookable = addDaysISO(today, (await getSiteSettings()).windowDays);
  const items: CartItem[] = [];
  let percentOff = 0;
  let promoCode: string | null = null;

  try {
    if (raw.promoCode != null && raw.promoCode !== "") {
      const code = cleanString(raw.promoCode, 40)?.toUpperCase();
      const promo = code ? await getPromo(code) : undefined;
      if (!promo || !promo.active) return err("That promo code is not valid.");
      promoCode = promo.code;
      percentOff = promo.percentOff;
    }

    for (const rawItem of raw.items as Partial<CartItem>[]) {
      const exp = typeof rawItem.roomId === "string" ? await getExperience(rawItem.roomId) : undefined;
      if (!exp || !exp.active) return err("One of the sessions refers to an unknown experience.");
      const date = typeof rawItem.date === "string" ? rawItem.date : "";
      const time = typeof rawItem.time === "string" ? rawItem.time : "";
      if (!isValidISODate(date) || date < today || date > lastBookable) {
        return err(`${exp.name}: that date can no longer be booked.`);
      }
      const hours = exp.scheduleMode === "store" ? await getLocationHours(exp.location) : null;
      if (!startTimesFor(exp, date, hours).includes(time)) {
        return err(`${exp.name}: that time slot is not available on that day.`);
      }
      const minParty = minPerBooking(exp, source);
      const maxParty = maxPerBooking(exp);
      const quantity = rawItem.quantity;
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < minParty || quantity > maxParty) {
        return err(`${exp.name}: guests must be between ${minParty} and ${maxParty}.`);
      }
      const booked = await bookedCountsForDate(date);
      const remaining = remainingSpots(exp, booked.get(`${exp.id}|${time}`) ?? 0);
      if (remaining < quantity) {
        return err(
          exp.isPrivate
            ? `${exp.name} at ${formatTime(time)} is already booked (private — one booking per slot).`
            : `${exp.name} at ${formatTime(time)} only has ${remaining} spot(s) left.`
        );
      }
      items.push({
        roomId: exp.id,
        roomName: exp.name,
        location: exp.location,
        date,
        time,
        quantity,
        priceCents: exp.priceCents,
        durationMinutes: exp.durationMinutes,
        depositPercent: exp.depositPercent,
        badgeBg: exp.badgeBg,
        badgeFg: exp.badgeFg,
      });
    }
  } catch (e) {
    console.error("booking build failed:", e);
    return { error: "Could not verify availability right now. Please try again shortly.", status: 500 };
  }

  const totals = computeTotals(items, percentOff, await activeTaxPercent());
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
    source,
    noShow: false,
    // Paid immediately (simulated checkout / staff walk-in). The Stripe flow
    // overrides these to hold the spots while payment happens.
    status: "paid",
    pendingExpiresAt: null,
    gameResult: null,
  };
  return { booking };
}
