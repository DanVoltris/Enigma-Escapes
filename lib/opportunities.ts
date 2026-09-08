// What the schedule is worth, and where it isn't working.
//
// Every other report counts what sold. This one counts what was OFFERED and
// didn't — the sessions published, staffed and never booked — because that is
// where the money is. Rooms here are private: one booking takes the room, so a
// published session is the unit of inventory, and a slot nobody books is the
// whole slot lost, not a few empty seats.
//
// Pure functions over data the caller loads, so every figure can be checked
// against the database without a browser.
import { WEEKDAYS, withoutTests } from "./behaviour";
import { parseISODate } from "./format";
import type { Booking, Experience } from "./types";

export type PublishedSlot = { roomId: string; date: string; time: string };

// One published start time, per room per day, minus anything blocked off.
// `startTimes` is injected rather than imported so this file stays pure and the
// caller can reuse the schedule helpers the rest of Reports already uses.
export function publishedSlots(
  experiences: Experience[],
  days: string[],
  startTimes: (exp: Experience, date: string) => string[],
  blockedKeys: Set<string> // "roomId|date|time"
): PublishedSlot[] {
  const out: PublishedSlot[] = [];
  for (const date of days) {
    for (const exp of experiences) {
      for (const time of startTimes(exp, date)) {
        if (blockedKeys.has(`${exp.id}|${date}|${time}`)) continue;
        out.push({ roomId: exp.id, date, time });
      }
    }
  }
  return out;
}

type Sold = { roomId: string; date: string; time: string; guests: number; cents: number };

function soldSessions(bookings: Booking[], from: string, to: string): Sold[] {
  const out: Sold[] = [];
  for (const b of withoutTests(bookings)) {
    if (b.status === "cancelled") continue;
    for (const i of b.items) {
      if (i.date < from || i.date > to || !i.time) continue;
      out.push({ roomId: i.roomId, date: i.date, time: i.time, guests: i.quantity, cents: i.priceCents * i.quantity });
    }
  }
  return out;
}

const hourOf = (time: string) => Number(time.slice(0, 2));
const weekdayOf = (date: string) => parseISODate(date).getDay();

export type Cell = {
  label: string;
  published: number;
  sold: number;
  cents: number;
  fill: number; // 0-1
  centsPerSlot: number; // revenue per PUBLISHED slot — the number that matters
};

function tally(
  published: PublishedSlot[],
  sold: Sold[],
  key: (s: { roomId: string; date: string; time: string }) => string | null,
  label: (k: string) => string
): Cell[] {
  const rows = new Map<string, { published: number; sold: number; cents: number }>();
  const get = (k: string) => {
    const r = rows.get(k) ?? { published: 0, sold: 0, cents: 0 };
    rows.set(k, r);
    return r;
  };
  for (const p of published) {
    const k = key(p);
    if (k !== null) get(k).published++;
  }
  for (const s of sold) {
    const k = key(s);
    if (k === null) continue;
    const r = get(k);
    r.sold++;
    r.cents += s.cents;
  }
  return Array.from(rows.entries()).map(([k, r]) => ({
    label: label(k),
    published: r.published,
    sold: r.sold,
    cents: r.cents,
    fill: r.published ? r.sold / r.published : 0,
    centsPerSlot: r.published ? Math.round(r.cents / r.published) : 0,
  }));
}

export type PartyBand = { label: string; bookings: number; avgCents: number };

export type Opportunities = {
  // Headline
  publishedSlots: number;
  soldSlots: number;
  fill: number;
  seatsSold: number;
  seatsOffered: number; // capacity of the sessions that DID sell
  seatFill: number; // how full a sold room actually is
  revenueCents: number;
  // Breakdowns, each sorted worst-first or best-first as the UI needs
  byRoom: Cell[];
  byLocation: Cell[];
  byWeekday: Cell[];
  byHour: Cell[];
  deadSquares: Cell[]; // weekday × hour that barely sells
  bestSquares: Cell[]; // weekday × hour in most demand
  deadRoomHours: Cell[]; // room × hour that never sells
  // Money and behaviour
  partyBands: PartyBand[];
  smallParties: PartyBand;
  largeParties: PartyBand;
  owedCents: number; // balances on sessions already played
  owedBookings: number;
  flatPrice: number | null; // set when every room charges the same, in cents
};

const MIN_SQUARE = 25; // below this a weekday × hour cell is too thin to judge
const MIN_ROOM_HOUR = 20;

export function opportunities(
  bookings: Booking[],
  experiences: Experience[],
  published: PublishedSlot[],
  from: string,
  to: string,
  today: string
): Opportunities {
  const sold = soldSessions(bookings, from, to);
  const roomName = new Map(experiences.map((e) => [e.id, e.name]));
  const roomLocation = new Map(experiences.map((e) => [e.id, e.location]));
  const roomCapacity = new Map(experiences.map((e) => [e.id, e.capacity]));

  const byRoom = tally(published, sold, (s) => s.roomId, (k) => roomName.get(k) ?? k).sort(
    (a, b) => b.centsPerSlot - a.centsPerSlot
  );
  const byLocation = tally(published, sold, (s) => roomLocation.get(s.roomId) ?? null, (k) => k).sort(
    (a, b) => b.centsPerSlot - a.centsPerSlot
  );
  const byWeekday = tally(published, sold, (s) => String(weekdayOf(s.date)), (k) => WEEKDAYS[Number(k)]).sort(
    (a, b) => WEEKDAYS.indexOf(a.label) - WEEKDAYS.indexOf(b.label)
  );
  const byHour = tally(published, sold, (s) => String(hourOf(s.time)).padStart(2, "0"), (k) => `${k}:00`).sort((a, b) =>
    a.label.localeCompare(b.label)
  );

  const squares = tally(
    published,
    sold,
    (s) => `${weekdayOf(s.date)}|${String(hourOf(s.time)).padStart(2, "0")}`,
    (k) => {
      const [d, h] = k.split("|");
      return `${WEEKDAYS[Number(d)].slice(0, 3)} ${h}:00`;
    }
  ).filter((c) => c.published >= MIN_SQUARE);

  const roomHours = tally(
    published,
    sold,
    (s) => `${s.roomId}|${String(hourOf(s.time)).padStart(2, "0")}`,
    (k) => {
      const [id, h] = k.split("|");
      return `${roomName.get(id) ?? id} · ${h}:00`;
    }
  ).filter((c) => c.published >= MIN_ROOM_HOUR);

  // Seats inside the sessions that sold — a private room booked by four is
  // still half empty, and that gap is the second lever after the empty slots.
  let seatsSold = 0;
  let seatsOffered = 0;
  for (const s of sold) {
    seatsSold += s.guests;
    seatsOffered += roomCapacity.get(s.roomId) ?? 0;
  }

  // Party size, on bookings PLACED in the window: what a bigger group is worth
  // for the same hour of the same room.
  const placed = withoutTests(bookings).filter((b) => {
    if (b.status === "cancelled") return false;
    return b.items.some((i) => i.date >= from && i.date <= to);
  });
  const bands = new Map<string, { n: number; cents: number }>();
  const band = (size: number) => (size <= 4 ? "2–4" : size <= 6 ? "5–6" : size <= 8 ? "7–8" : "9+");
  let small = { n: 0, cents: 0 };
  let large = { n: 0, cents: 0 };
  for (const b of placed) {
    const size = b.items.reduce((s, i) => s + i.quantity, 0);
    const g = bands.get(band(size)) ?? { n: 0, cents: 0 };
    g.n++;
    g.cents += b.pricing.totalCents;
    bands.set(band(size), g);
    if (size <= 4) {
      small.n++;
      small.cents += b.pricing.totalCents;
    } else if (size >= 8) {
      large.n++;
      large.cents += b.pricing.totalCents;
    }
  }
  const toBand = (label: string, g: { n: number; cents: number }): PartyBand => ({
    label,
    bookings: g.n,
    avgCents: g.n ? Math.round(g.cents / g.n) : 0,
  });

  // Balances still owed on sessions that have already been played — money that
  // was either taken at the desk and never recorded, or never taken.
  let owedCents = 0;
  let owedBookings = 0;
  for (const b of placed) {
    if ((b.pricing.balanceCents ?? 0) <= 0) continue;
    if (!b.items.every((i) => i.date < today)) continue;
    owedCents += b.pricing.balanceCents;
    owedBookings++;
  }

  const prices = new Set(experiences.map((e) => e.priceCents));
  const revenueCents = sold.reduce((s, x) => s + x.cents, 0);

  return {
    publishedSlots: published.length,
    soldSlots: sold.length,
    fill: published.length ? sold.length / published.length : 0,
    seatsSold,
    seatsOffered,
    seatFill: seatsOffered ? seatsSold / seatsOffered : 0,
    revenueCents,
    byRoom,
    byLocation,
    byWeekday,
    byHour,
    deadSquares: [...squares].sort((a, b) => a.fill - b.fill).slice(0, 8),
    bestSquares: [...squares].sort((a, b) => b.fill - a.fill).slice(0, 8),
    deadRoomHours: [...roomHours].sort((a, b) => a.fill - b.fill).slice(0, 8),
    partyBands: ["2–4", "5–6", "7–8", "9+"].map((l) => toBand(l, bands.get(l) ?? { n: 0, cents: 0 })),
    smallParties: toBand("2–4", small),
    largeParties: toBand("8+", large),
    owedCents,
    owedBookings,
    flatPrice: prices.size === 1 ? [...prices][0] : null,
  };
}

// --- Recommendations -----------------------------------------------------------

// A suggestion earns its place by citing the figures that produced it. `impact`
// is arithmetic under an assumption stated in `assumption` — never a forecast:
// "if volumes held" is doing real work in those sentences, and the UI prints it.
export type Suggestion = {
  id: string;
  title: string;
  finding: string; // what the data says
  action: string; // what to do about it
  evidence: string[]; // the figures behind it
  impactCents?: number;
  // Whether impactCents recurs every week or happens once. Ranking compares a
  // year of each: money owed is real but collected once, and putting it above a
  // change worth the same every week would point the owner at the smaller prize.
  cadence?: "weekly" | "once";
  assumption?: string;
  weight: number; // tie-break only — bigger first
};

function annualised(s: Suggestion): number {
  if (!s.impactCents) return 0;
  return s.cadence === "weekly" ? s.impactCents * 52 : s.impactCents;
}

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function suggestions(o: Opportunities, weeks: number): Suggestion[] {
  const out: Suggestion[] = [];
  const perWeek = (cents: number) => (weeks > 0 ? Math.round(cents / weeks) : 0);

  // 1. Sessions published into hours nobody books.
  const dead = o.deadSquares.filter((c) => c.fill <= 0.06);
  if (dead.length >= 2) {
    const slots = dead.reduce((s, c) => s + c.published, 0);
    const earned = dead.reduce((s, c) => s + c.cents, 0);
    out.push({
      id: "dead-squares",
      title: "Stop publishing the hours that never sell",
      finding: `${dead.length} weekday-and-hour combinations are on the schedule but barely book. Together they account for ${slots} published sessions and earned ${money(earned)} — about ${money(Math.round(earned / slots))} a session against a site average of ${money(Math.round(o.revenueCents / Math.max(1, o.publishedSlots)))}.`,
      action:
        "Take the worst of them off the grid, or collapse them into fewer start times. Each one still has to be staffable, and a customer looking at a page of times that are mostly empty learns the rooms are never busy.",
      evidence: dead.slice(0, 5).map((c) => `${c.label}: ${c.sold} of ${c.published} sold (${pct(c.fill)})`),
      weight: slots,
    });
  }

  // 2. One price for every hour, when the hours are worth wildly different amounts.
  if (o.flatPrice && o.bestSquares.length && o.deadSquares.length) {
    const best = o.bestSquares[0];
    const worst = o.deadSquares[0];
    const strong = o.bestSquares.filter((c) => c.fill >= 0.22);
    const uplift = 500; // $5 a head, the smallest change worth testing
    const seatsInStrong = strong.reduce((s, c) => s + c.sold, 0) * (o.seatsSold / Math.max(1, o.soldSlots));
    out.push({
      id: "flat-pricing",
      title: "Charge more for the hours people actually want",
      finding: `Every room is ${money(o.flatPrice)} a person at every hour of every day, but demand is nothing like flat: ${best.label} fills at ${pct(best.fill)} while ${worst.label} fills at ${pct(worst.fill)}. The busiest hours are subsidising the empty ones.`,
      action: `Try a higher weekend-evening price and a lower midweek-daytime one. The quiet hours have almost nothing to lose — they are close to empty at today's price — and the busy ones are the ones being given away.`,
      evidence: [
        ...strong.slice(0, 3).map((c) => `${c.label}: ${pct(c.fill)} full, ${money(c.centsPerSlot)} per published session`),
        `versus ${worst.label}: ${pct(worst.fill)} full, ${money(worst.centsPerSlot)} per published session`,
      ],
      cadence: "weekly",
      impactCents: perWeek(Math.round(seatsInStrong * uplift)),
      assumption: `a ${money(uplift)}-a-head rise on the strongest hours only, if the same number of people still booked them`,
      weight: 900,
    });
  }

  // 3. Private rooms sold to small groups.
  if (o.seatFill > 0 && o.seatFill < 0.62 && o.smallParties.bookings > 0 && o.largeParties.bookings > 0) {
    const ratio = o.largeParties.avgCents / Math.max(1, o.smallParties.avgCents);
    const shift = Math.round(o.smallParties.bookings * 0.1);
    out.push({
      id: "party-size",
      title: "Get more people into the rooms you already sell",
      finding: `A sold session runs at ${pct(o.seatFill)} of its seats — an average party of ${(o.seatsSold / Math.max(1, o.soldSlots)).toFixed(1)}. Because the rooms are private, a party of four and a party of eight take exactly the same hour: ${o.smallParties.bookings} bookings of four or fewer averaged ${money(o.smallParties.avgCents)}, while ${o.largeParties.bookings} of eight or more averaged ${money(o.largeParties.avgCents)} — ${ratio.toFixed(1)} times as much for the same inventory.`,
      action:
        "Say what the room holds at the point of booking, and give a reason to bring more people — a per-head price that drops above six, or a line on the room page. This is the cheapest lever here: it needs no new slot and no new customer.",
      evidence: o.partyBands
        .filter((b) => b.bookings > 0)
        .map((b) => `party of ${b.label}: ${b.bookings} bookings, ${money(b.avgCents)} average`),
      cadence: "weekly",
      impactCents: perWeek(shift * (o.largeParties.avgCents - o.smallParties.avgCents)),
      assumption: `if one in ten small parties brought enough people to reach eight`,
      weight: 800,
    });
  }

  // 4. A location dragging the average down.
  if (o.byLocation.length >= 2) {
    const best = o.byLocation[0];
    const worst = o.byLocation[o.byLocation.length - 1];
    if (worst.centsPerSlot < best.centsPerSlot * 0.7 && worst.published >= 100) {
      out.push({
        id: "weak-location",
        title: `${worst.label} earns half what ${best.label} does from the same schedule`,
        finding: `${worst.label} sold ${worst.sold} of ${worst.published} published sessions (${pct(worst.fill)}), worth ${money(worst.centsPerSlot)} a session. ${best.label} sold ${pct(best.fill)} at ${money(best.centsPerSlot)}.`,
        action:
          "Worth knowing which it is before spending on it: a location problem (harder to reach, less passing trade), a room problem (the games there are weaker draws), or a schedule problem (too many hours open). The room table below separates the last two.",
        evidence: o.byLocation.map((c) => `${c.label}: ${c.sold}/${c.published} (${pct(c.fill)}), ${money(c.centsPerSlot)} per session`),
        weight: 700,
      });
    }
  }

  // 5. Money owed on games that have already been played.
  if (o.owedCents >= 25000) {
    out.push({
      id: "owed",
      title: "Collect what's owed on sessions that already ran",
      finding: `${o.owedBookings} bookings whose games have been played still show a balance, totalling ${money(o.owedCents)}. Either it was taken at the desk and never recorded, or it was never taken.`,
      action:
        "Work through the list on the Bookings tab filtered by balance. If the money did come in, recording it keeps the figures honest; if it didn't, it is still collectable while the booking is recent.",
      evidence: [`${o.owedBookings} played bookings carrying a balance`, `${money(o.owedCents)} outstanding`],
      cadence: "once",
      impactCents: o.owedCents,
      assumption: "the full amount is recoverable, which some of it will not be",
      weight: 600,
    });
  }

  // 6. A room that isn't paying for its place on the grid.
  const rooms = o.byRoom.filter((c) => c.published >= 100);
  if (rooms.length >= 3) {
    const best = rooms[0];
    const worst = rooms[rooms.length - 1];
    if (worst.centsPerSlot < best.centsPerSlot * 0.5) {
      out.push({
        id: "weak-room",
        title: `${worst.label} earns ${money(worst.centsPerSlot)} a session against ${best.label}'s ${money(best.centsPerSlot)}`,
        finding: `Both are open a similar number of hours, and both cost the same to staff. ${worst.label} sold ${worst.sold} of ${worst.published}; ${best.label} sold ${best.sold} of ${best.published}.`,
        action: `Give ${worst.label} fewer, better hours rather than the same grid as everything else — the hours ${best.label} fills are the ones worth keeping. A room that never sells at noon does not need a noon session.`,
        evidence: rooms.slice(0, 3).concat(rooms.slice(-2)).map((c) => `${c.label}: ${pct(c.fill)} full, ${money(c.centsPerSlot)} per published session`),
        weight: 500,
      });
    }
  }

  return out.sort((a, b) => annualised(b) - annualised(a) || b.weight - a.weight);
}
