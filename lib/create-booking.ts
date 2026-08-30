import { randomUUID } from "crypto";
import { blockedKeysForDate, isBlocked } from "./blocks";
import { maxPerBooking, minPerBooking, minutesOfTime, minutesToTime, overlappedBy, remainingSpots } from "./capacity";
import { bookedCountsForDate, busySessionsForDate, getPromo } from "./db";
import { getExperience } from "./experiences";
import { addDaysISO, formatTime, isValidISODate, minutesUntilSlot, REQUEST_WINDOW_MINUTES, todayISO } from "./format";
import { getLocationHours } from "./hours";
import { getRequestByToken } from "./requests";
import { getRewardCode, rewardProblem } from "./reward-codes";
import { startTimesFor } from "./schedule";
import { activeTaxPercent } from "./taxes";
import {
  CORPORATE_FEE_CENTS,
  CORPORATE_LEAD_IN_MINUTES,
  cardDueCents,
  computeTotals,
  voucherAppliedCents,
} from "./pricing";
import { getPricingMode } from "./pricing-settings";
import { getVoucher } from "./vouchers";
import { voucherProblem } from "./voucher-types";
import { getSiteSettings } from "./site-settings";
import type { Booking, BookingSource, CartItem, Customer } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Off-grid start times are typed rather than chosen, so they are checked.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  voucherCode?: unknown; // gift voucher put towards the booking
  requestToken?: unknown; // accepted booking-request token (sub-4h completions)
  corporate?: unknown; // staff-only: a corporate event (flat fee + team building)
  leadInMinutes?: unknown; // how early the group arrives, when corporate
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
  // "none" records a booking with nothing paid. Only the desk may do that —
  // offering it to the public would be a free-booking button.
  const optionAllowed =
    paymentOption === "full" ||
    paymentOption === "deposit" ||
    (paymentOption === "none" && source === "in_person");
  if (!optionAllowed) {
    return err("Choose whether to pay the full balance or the deposit.");
  }

  // A corporate event: the desk's own booking type. Refused from the public
  // checkout outright — it sets its own price and can sit off the published
  // schedule, so it is not something a crafted request may ask for.
  const corporate = raw.corporate === true;
  if (corporate && source !== "in_person") {
    return err("Corporate events are booked by staff, not through the website.");
  }
  const leadInMinutes = corporate
    ? Math.min(240, Math.max(0, Number(raw.leadInMinutes ?? CORPORATE_LEAD_IN_MINUTES) || 0))
    : 0;

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    return err("Add at least one session before booking.");
  }

  const today = todayISO();
  const lastBookable = addDaysISO(today, (await getSiteSettings()).windowDays);
  const items: CartItem[] = [];
  let percentOff = 0;
  let promoCode: string | null = null;
  let rewardCode: string | null = null;
  let voucherCode: string | null = null;

  try {
    if (raw.promoCode != null && raw.promoCode !== "") {
      const code = cleanString(raw.promoCode, 40)?.toUpperCase();
      const promo = code ? await getPromo(code) : undefined;
      if (promo && promo.active) {
        promoCode = promo.code;
        percentOff = promo.percentOff;
      } else {
        // Not a promo — it may be a 20% reward code from an earlier booking.
        // Those are checked against the cart below, once the sessions are
        // known, because a reward only works on a LATER session.
        const reward = code ? await getRewardCode(code) : undefined;
        if (!reward) return err("That promo code is not valid.");
        rewardCode = reward.code;
        percentOff = reward.percentOff;
      }
    }

    for (const rawItem of raw.items as (Partial<CartItem> & { customTime?: unknown })[]) {
      const exp = typeof rawItem.roomId === "string" ? await getExperience(rawItem.roomId) : undefined;
      if (!exp || !exp.active) return err("One of the sessions refers to an unknown experience.");
      const date = typeof rawItem.date === "string" ? rawItem.date : "";
      const time = typeof rawItem.time === "string" ? rawItem.time : "";
      if (!isValidISODate(date) || date < today || date > lastBookable) {
        return err(`${exp.name}: that date can no longer be booked.`);
      }
      // Two kinds of booking run to their own clock rather than the published
      // grid: a corporate event, and any session the desk deliberately marks as
      // a custom time. Everything that protects the room still runs below:
      // blocked slots, overlapping games and capacity are all checked the same
      // way, so an off-grid start takes the slots it overlaps with it.
      //
      // The flag has to be deliberate. Accepting any time from the desk would
      // also swallow the mistakes this check exists to catch — a stale room
      // list offering times the room no longer runs.
      const offGrid = corporate || (source === "in_person" && rawItem.customTime === true);
      if (!offGrid) {
        const hours = exp.scheduleMode === "store" ? await getLocationHours(exp.location) : null;
        if (!startTimesFor(exp, date, hours).includes(time)) {
          return err(`${exp.name}: that time slot is not available on that day.`);
        }
      } else if (!TIME_RE.test(time)) {
        return err(`${exp.name}: give the start time as HH:MM on a 24-hour clock, e.g. 18:30.`);
      }
      // Manager-blocked slots are out of service for everyone, walk-ins
      // included — unblock it first if the session should really run.
      if (await isBlocked(exp.id, date, time)) {
        return err(`${exp.name} at ${formatTime(time)} is blocked off and can't be booked.`);
      }
      // An off-grid start can run straight through a blocked slot without ever
      // landing on it. A block takes the room out of service for the length of
      // a game, so it is checked the same way a live session is.
      if (offGrid) {
        const blocked = [...(await blockedKeysForDate(date))]
          .filter((key) => key.slice(0, key.indexOf("|")) === exp.id)
          .map((key) => key.slice(key.indexOf("|") + 1))
          .map((t) => ({
            time: t,
            start: minutesOfTime(t),
            end: minutesOfTime(t) + exp.durationMinutes,
            guests: 0,
          }));
        const blockClash = overlappedBy(blocked, time, exp.durationMinutes);
        if (blockClash) {
          return err(
            `${exp.name} is blocked off ${formatTime(blockClash.time)}–` +
              `${formatTime(minutesToTime(blockClash.end))} that day, so ${formatTime(time)} can't be booked.`
          );
        }
      }
      // Slots starting within the request window aren't self-serve: they need
      // an ACCEPTED request behind them (staff walk-ins are exempt — that's
      // the manager acting directly). Blocks crafted checkout calls too.
      if (source === "online" && minutesUntilSlot(date, time) <= REQUEST_WINDOW_MINUTES) {
        if (minutesUntilSlot(date, time) <= 0) return err(`${exp.name}: that time has already started.`);
        const token = typeof raw.requestToken === "string" ? raw.requestToken : "";
        const request = token ? await getRequestByToken(token) : undefined;
        const matches =
          request &&
          request.status === "accepted" &&
          request.roomId === exp.id &&
          request.date === date &&
          request.time === time;
        if (!matches) {
          return err(
            `${exp.name} at ${formatTime(time)} starts soon — send a booking request and we'll confirm by text.`
          );
        }
      }
      const minParty = minPerBooking(exp, source);
      const maxParty = maxPerBooking(exp);
      const quantity = rawItem.quantity;
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < minParty || quantity > maxParty) {
        return err(`${exp.name}: guests must be between ${minParty} and ${maxParty}.`);
      }
      // The room has to be free for the whole game, not just at its start —
      // otherwise a 2:00 start sells while the 1:15 game is still running in it.
      const clash = overlappedBy((await busySessionsForDate(date)).get(exp.id), time, exp.durationMinutes);
      if (clash) {
        return err(
          `${exp.name} is running ${formatTime(clash.time)}–${formatTime(minutesToTime(clash.end))} that day, ` +
            `so ${formatTime(time)} isn't free.`
        );
      }
      // The rooms on THIS booking can clash with each other too, and the day's
      // saved sessions don't know about them yet — they are all one unsaved
      // submission. Same room twice at one time is one slot sold twice; a
      // custom start that runs into another row is the same room in two places.
      const siblings = items
        .filter((i) => i.roomId === exp.id && i.date === date)
        .map((i) => ({
          time: i.time,
          start: minutesOfTime(i.time),
          end: minutesOfTime(i.time) + i.durationMinutes,
          guests: i.quantity,
        }));
      if (siblings.some((s) => s.time === time)) {
        return err(`${exp.name} is on this booking twice at ${formatTime(time)}.`);
      }
      const selfClash = overlappedBy(siblings, time, exp.durationMinutes);
      if (selfClash) {
        return err(
          `${exp.name} is already on this booking ${formatTime(selfClash.time)}–` +
            `${formatTime(minutesToTime(selfClash.end))}, so ${formatTime(time)} isn't free.`
        );
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
        ...(leadInMinutes > 0 ? { leadInMinutes } : {}),
        depositPercent: exp.depositPercent,
        badgeBg: exp.badgeBg,
        badgeFg: exp.badgeFg,
      });
    }
  } catch (e) {
    console.error("booking build failed:", e);
    return { error: "Could not verify availability right now. Please try again shortly.", status: 500 };
  }

  // The reward's rules need the sessions, so they are enforced here rather
  // than in the block above: it is locked to the phone that earned it, dies
  // when that booking's session starts, and only discounts a later session.
  if (rewardCode) {
    let reward;
    try {
      reward = await getRewardCode(rewardCode);
    } catch (e) {
      console.error("reward lookup failed:", e);
      return { error: "Could not check that code right now. Please try again shortly.", status: 500 };
    }
    if (!reward) return err("That promo code is not valid.");
    const earliest = items.map((i) => `${i.date}T${i.time}:00`).sort()[0];
    const problem = rewardProblem(reward, { phone: customer.phone, sessionStart: earliest });
    if (problem) return err(problem);
  }

  const flatFeeCents = corporate ? CORPORATE_FEE_CENTS : 0;
  const totals = computeTotals(
    items,
    percentOff,
    await activeTaxPercent(),
    await getPricingMode(),
    flatFeeCents,
    !rewardCode // a promo reaches the fee; the 20% loyalty code doesn't
  );

  // Gift voucher — a prepaid balance, checked here against the real cart so the
  // date / time / experience rules on the voucher are enforced server-side. The
  // balance is not spent yet: that happens once the booking is actually paid.
  let voucherCents = 0;
  if (raw.voucherCode != null && raw.voucherCode !== "") {
    const code = cleanString(raw.voucherCode, 40)?.toUpperCase();
    let voucher;
    try {
      voucher = code ? await getVoucher(code) : undefined;
    } catch (e) {
      console.error("voucher lookup failed:", e);
      return { error: "Could not check the gift voucher right now. Please try again shortly.", status: 500 };
    }
    if (!voucher) return err("That gift voucher code is not valid.");
    const first = items[0];
    const problem = voucherProblem(voucher, {
      today,
      date: first?.date,
      time: first?.time,
      roomId: first?.roomId,
    });
    if (problem) return err(problem);
    if (voucher.redemptionType === "spaces") {
      return err("That voucher is for spaces rather than a dollar amount — please call us to book it.");
    }
    voucherCode = voucher.code;
    voucherCents = voucherAppliedCents(totals, voucher.remainingCents);
    if (voucherCents <= 0) return err("That gift voucher has no balance left.");
  }

  // The card covers whatever the voucher doesn't. Both count as paid: the
  // voucher is money the customer handed over when they bought it.
  const cardCents = cardDueCents(totals, paymentOption, voucherCents);
  const paidCents = cardCents + voucherCents;
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
      ...(corporate ? { corporate: true, flatFeeCents } : {}),
      voucherCode,
      voucherCents,
      voucherRedeemed: false, // set once the balance is actually taken
      // Kept so cancelling the booking that earned this reward can find the
      // booking that spent it and put the price back up.
      rewardCode,
    },
    source,
    noShow: false,
    // Paid immediately (simulated checkout / staff walk-in). The Stripe flow
    // overrides these to hold the spots while payment happens.
    status: "paid",
    pendingExpiresAt: null,
    gameResult: null,
    notes: [],
  };
  return { booking };
}
