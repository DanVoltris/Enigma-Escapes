// Movie-premiere prize draw. A one-off promotion: every booking bought between
// DRAW_FROM and DRAW_TO is entered automatically, and on DRAW_DATE an admin
// presses a button that picks WINNERS_PER_LOCATION names at each location,
// each winning TICKETS_PER_WINNER seats.
//
// The result is written once and then read back forever after. A draw that can
// be quietly re-rolled until the names look right is worth nothing if a
// customer ever asks how it was run, so runDraw refuses to overwrite an
// existing result and stores the entry list it drew from alongside the winners.
//
// Temporary by design: when the promotion is over, delete this file, the
// /manager/draw route, the API route and the nav tab, and the confirmation
// notice. Nothing else depends on it.
import { randomInt } from "crypto";
import { listBookings } from "./db";
import { listLocations } from "./experiences";
import { addDaysISO, businessDateOf, todayISO } from "./format";
import { getSetting, saveSetting } from "./settings";
import type { Booking } from "./types";

export const DRAW_FROM = "2026-09-04"; // inclusive, venue-local date
export const DRAW_TO = "2026-09-07"; // inclusive, venue-local date
export const DRAW_DATE = "2026-09-08"; // the day the winners are drawn, venue-local
export const WINNERS_PER_LOCATION = 4;
export const TICKETS_PER_WINNER = 2;

// What the winners actually get. Named rather than left as "movie tickets" so
// staff ringing round know what they are offering, and so the customer notice
// says something worth reading. The poster is a static file in public/.
export const MOVIE_TITLE = "Heart of the Beast";
export const MOVIE_POSTER = "/heart-of-the-beast.jpg";
// An advance screening, ahead of the film's general release on the 25th. Worth
// naming on the confirmation: "premiere tickets" on its own doesn't tell a
// customer they'd need that evening free.
export const SCREENING_DATE = "2026-09-09";

const DRAW_KEY = "premiere_draw";

export type DrawEntry = {
  bookingId: string;
  reference: string;
  location: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
  walkIn: boolean;
};

export type DrawWinner = DrawEntry & { tickets: number };

export type DrawResult = {
  drawnAt: string; // ISO
  drawnBy: string; // staff name who pressed the button
  // Recorded with the result rather than read from the constant, so a draw
  // stays self-describing if the constant is ever changed or deleted.
  movie?: string;
  from: string;
  to: string;
  winnersPerLocation: number;
  ticketsPerWinner: number;
  winners: DrawWinner[];
  // The pool as it stood at the moment of the draw, kept so the result can be
  // audited later even though bookings keep changing underneath it.
  entryCount: number;
  entriesByLocation: Record<string, number>;
};

// Is this booking's purchase date inside the promotion? Compared as venue-local
// calendar dates: the server runs in UTC on Vercel, so a booking taken at 7pm
// Winnipeg time on the 19th is already the 20th in UTC and would otherwise fall
// out of the window. ISO dates compare correctly as plain strings.
export function isInDrawWindow(createdAt: string): boolean {
  const date = businessDateOf(createdAt);
  return date >= DRAW_FROM && date <= DRAW_TO;
}

// The draw can't be run before its day. Entries are still coming in until the
// 19th closes, so drawing early would pick from a pool that isn't finished —
// and the button being live is enough for someone to press it by accident.
// Venue-local, so it unlocks at midnight in Winnipeg rather than in UTC.
export function drawIsOpen(): boolean {
  return todayISO() >= DRAW_DATE;
}

// Desk bookings get filed under stand-in accounts — the old system's minted
// addresses, the shop's own, typed-in fakes. The same list lives in
// scripts/import-bookings.mjs, which is where these patterns were worked out.
// They matter here because two walk-ins sharing "walkinn1@resova.com" are two
// different parties, and collapsing them would let only one of them ever win.
const PLACEHOLDER_EMAILS = [
  /^n\/a$/i,
  /\.temp@/i,
  /@resova\.com/i,
  /@temp\./i,
  /^info@gamemasterescapes\.com$/i,
  /^walk-?in/i,
  /^gmail123@gmail\.com$/i,
];

// The contact details we can actually use. A placeholder account's phone is
// shared by every walk-in filed under it, so it is nobody's number either —
// blanking both is what stops those entries merging into one entrant.
function usableContact(email: string, phone: string): { email: string; phone: string } {
  const real = email.includes("@") && !PLACEHOLDER_EMAILS.some((re) => re.test(email));
  return real ? { email, phone } : { email: "", phone: "" };
}

// How we decide two entries are the same person, so nobody wins twice. Email
// first, then phone; a walk-in with neither is treated as its own person rather
// than being merged with every other contactless walk-in.
function identityOf(entry: DrawEntry): string {
  const email = entry.email.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = entry.phone.replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  return `booking:${entry.bookingId}`;
}

// One entry per booking per distinct location it touches. A booking holding two
// rooms at one location is a single entry; a booking spanning two locations is
// entered in both draws. Pure, so the numbers can be checked without a database.
export function buildEntries(bookings: Booking[]): DrawEntry[] {
  const entries: DrawEntry[] = [];
  for (const booking of bookings) {
    if (!isInDrawWindow(booking.createdAt)) continue;
    const locations: string[] = [];
    for (const item of booking.items) {
      if (item.location && !locations.includes(item.location)) locations.push(item.location);
    }
    const customer = booking.customer;
    const name = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim();
    const contact = usableContact((customer.email ?? "").trim(), (customer.phone ?? "").trim());
    for (const location of locations) {
      entries.push({
        bookingId: booking.id,
        reference: booking.reference,
        location,
        name,
        email: contact.email,
        phone: contact.phone,
        createdAt: booking.createdAt,
        walkIn: booking.source === "in_person",
      });
    }
  }
  return entries;
}

// Every entry currently in the pool. listBookings already drops cancellations
// and lapsed pending checkouts (isLiveBooking), which is exactly the rule here —
// no-shows still count, they paid. A day of slack on the query covers the
// UTC-to-venue offset; isInDrawWindow does the exact filtering.
export async function listEntries(): Promise<DrawEntry[]> {
  const bookings = await listBookings({ since: addDaysISO(DRAW_FROM, -1) });
  return buildEntries(bookings);
}

export function countByLocation(entries: DrawEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) counts[entry.location] = (counts[entry.location] ?? 0) + 1;
  return counts;
}

// Fisher-Yates using crypto.randomInt — a uniform shuffle from a proper random
// source. Math.random would be biased and seedable, which is not what you want
// deciding who gets a prize.
function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Picks the winners without saving. Locations are drawn in their listed order,
// and anyone who has already won is skipped so a customer who booked at two
// venues can't take two prizes.
export function pickWinners(entries: DrawEntry[], locations: string[]): DrawWinner[] {
  const winners: DrawWinner[] = [];
  const alreadyWon = new Set<string>();
  for (const location of locations) {
    const pool = shuffled(entries.filter((e) => e.location === location));
    let taken = 0;
    for (const entry of pool) {
      if (taken >= WINNERS_PER_LOCATION) break;
      const identity = identityOf(entry);
      if (alreadyWon.has(identity)) continue;
      alreadyWon.add(identity);
      winners.push({ ...entry, tickets: TICKETS_PER_WINNER });
      taken++;
    }
  }
  return winners;
}

export async function getDrawResult(): Promise<DrawResult | null> {
  try {
    const { value } = await getSetting<DrawResult>(DRAW_KEY);
    return value && Array.isArray(value.winners) ? value : null;
  } catch {
    return null;
  }
}

// Runs the draw and saves it. Refuses if one already exists — re-running is the
// one thing that would make the whole result untrustworthy.
export async function runDraw(drawnBy: string): Promise<{ ok: true; result: DrawResult } | { ok: false; error: string }> {
  if (!drawIsOpen()) {
    return { ok: false, error: `The draw can't be run until ${DRAW_DATE}, once entries have closed.` };
  }
  const existing = await getDrawResult();
  if (existing) {
    return { ok: false, error: "The draw has already been run. Its result is final and can't be drawn again." };
  }
  const [entries, locations] = await Promise.all([listEntries(), listLocations()]);
  if (entries.length === 0) {
    return { ok: false, error: "There are no entries yet, so there is nothing to draw." };
  }
  const winners = pickWinners(entries, locations);
  const result: DrawResult = {
    drawnAt: new Date().toISOString(),
    drawnBy,
    movie: MOVIE_TITLE,
    from: DRAW_FROM,
    to: DRAW_TO,
    winnersPerLocation: WINNERS_PER_LOCATION,
    ticketsPerWinner: TICKETS_PER_WINNER,
    winners,
    entryCount: entries.length,
    entriesByLocation: countByLocation(entries),
  };
  await saveSetting(DRAW_KEY, result);
  return { ok: true, result };
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Winners as a spreadsheet, for working through the phone calls.
export function winnersCsv(result: DrawResult): string {
  const rows = [
    ["Location", "Name", "Email", "Phone", "Booking reference", "Tickets", "Booked at desk"],
    ...result.winners.map((w) => [
      w.location,
      w.name,
      w.email,
      w.phone,
      w.reference,
      w.tickets,
      w.walkIn ? "yes" : "no",
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
