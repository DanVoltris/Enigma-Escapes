// First-party site events: what visitors looked for and where they stopped.
// The table (scripts/site-events.sql) holds no personal data — `visitor` is a
// random cookie id, `props` only what each event kind is allowed to carry — and
// rows are pruned after RETENTION_DAYS. Writes never throw: an analytics
// failure must not take a customer's availability lookup down with it.
import { addDaysISO, businessDateOf, parseISODate } from "./format";
import { getSetting, saveSetting } from "./settings";
import { rest, restAllPages } from "./supabase";
import { VISITOR_COOKIE } from "./visitor";

export { VISITOR_COOKIE };
export const RETENTION_DAYS = 180;

// availability_look is written server-side; the rest arrive from the browser
// through /api/events and are held to the allowlist below.
export type EventKind =
  | "availability_look"
  | "add_to_cart"
  | "begin_checkout"
  | "checkout_details"
  | "payment_started"
  | "purchase";

// What each browser-sent event may carry, and nothing else. Unknown kinds are
// refused, unknown fields dropped, strings cut, numbers coerced — the browser
// is not a trusted source of anything, least of all analytics.
const CLIENT_EVENTS: Record<string, (p: Record<string, unknown>) => Record<string, unknown>> = {
  add_to_cart: (p) => ({ room: str(p.room, 80), cents: int(p.cents) }),
  begin_checkout: (p) => ({ cents: int(p.cents), items: int(p.items) }),
  checkout_details: () => ({}),
  payment_started: (p) => ({ method: p.method === "stripe" ? "stripe" : "simulated" }),
  purchase: (p) => ({ cents: int(p.cents), reference: str(p.reference, 20) }),
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

export function cleanClientEvent(kind: unknown, props: unknown): { kind: EventKind; props: Record<string, unknown> } | null {
  if (typeof kind !== "string" || !(kind in CLIENT_EVENTS)) return null;
  const o = props && typeof props === "object" ? (props as Record<string, unknown>) : {};
  return { kind: kind as EventKind, props: CLIENT_EVENTS[kind](o) };
}

export type SiteEvent = {
  id: string;
  at: string; // ISO
  kind: EventKind;
  visitor: string | null;
  path: string | null;
  props: Record<string, unknown>;
};

// Only a random id of the shape we set is accepted back — anything else in the
// cookie is dropped rather than stored.
function cleanVisitor(v: string | null | undefined): string | null {
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null;
}

export async function recordEvent(
  kind: EventKind,
  props: Record<string, unknown>,
  opts: { visitor?: string | null; path?: string | null } = {}
): Promise<void> {
  try {
    const res = await rest("site_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{ kind, visitor: cleanVisitor(opts.visitor), path: opts.path ?? null, props }]),
    });
    if (!res.ok && res.status !== 404) console.error(`recording ${kind} failed (Supabase ${res.status})`);
  } catch (err) {
    console.error(`recording ${kind} failed:`, err); // table missing or network — never the caller's problem
  }
}

// Events of one kind whose venue-local date falls in [from, to]. Null when the
// table doesn't exist yet, so the report can say so instead of showing zeros.
export async function listEvents(kind: EventKind, from: string, to: string): Promise<SiteEvent[] | null> {
  const rows = await restAllPages<SiteEvent>(
    `site_events?select=*&kind=eq.${kind}&at=gte.${addDaysISO(from, -1)}&at=lt.${addDaysISO(to, 2)}&order=at.desc`,
    "Loading site events"
  );
  if (rows === null) return null;
  return rows.filter((e) => {
    const d = businessDateOf(e.at);
    return d >= from && d <= to;
  });
}

export async function listEventsOfKinds(kinds: EventKind[], from: string, to: string): Promise<SiteEvent[] | null> {
  const rows = await restAllPages<SiteEvent>(
    `site_events?select=*&kind=in.(${kinds.join(",")})&at=gte.${addDaysISO(from, -1)}&at=lt.${addDaysISO(to, 2)}&order=at.desc`,
    "Loading site events"
  );
  if (rows === null) return null;
  return rows.filter((e) => {
    const d = businessDateOf(e.at);
    return d >= from && d <= to;
  });
}

// Drops rows older than the retention period, at most once a day. Called from
// the report that reads the table, so retention needs no scheduler.
const PRUNED_KEY = "site_events_pruned_on";
export async function pruneEvents(today: string): Promise<void> {
  try {
    const { value } = await getSetting<string>(PRUNED_KEY);
    if (value === today) return;
    await rest(`site_events?at=lt.${addDaysISO(today, -RETENTION_DAYS)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    await saveSetting(PRUNED_KEY, today);
  } catch (err) {
    console.error("pruning site events failed:", err);
  }
}

// --- Unmet demand ------------------------------------------------------------

// One availability look: the date asked for and, per room offered that day,
// how many start times were shown and how many could still be booked.
export type LookRoom = { roomId: string; roomName: string; location: string; shown: number; bookable: number };
export type LookProps = { date: string; rooms: LookRoom[] };

export type DemandRow = { label: string; looks: number; soldOut: number };
export type Demand = {
  looks: number;
  visitors: number | null; // null until visitor ids exist in the data
  nothingBookable: number; // looks where no room at all had a slot left
  byRoom: DemandRow[]; // looks where the room was shown vs. shown but fully sold
  byWeekday: DemandRow[]; // by the weekday of the date asked for
  topDates: { date: string; looks: number; nothingBookable: number }[];
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isLook(p: unknown): p is LookProps {
  const o = p as LookProps;
  return !!o && typeof o.date === "string" && Array.isArray(o.rooms);
}

// Which rooms people wanted and couldn't have. A room counts as sold out on a
// look when it was offered that day but every start time was taken. Scoped
// staff see only their locations' rooms.
export function unmetDemand(events: SiteEvent[], scope: string[] | null): Demand {
  const rooms = new Map<string, DemandRow>();
  const weekdays = WEEKDAYS.map((label) => ({ label, looks: 0, soldOut: 0 }));
  const dates = new Map<string, { date: string; looks: number; nothingBookable: number }>();
  const visitors = new Set<string>();
  let looks = 0;
  let nothingBookable = 0;
  for (const e of events) {
    if (!isLook(e.props)) continue;
    const offered = e.props.rooms.filter((r) => r.shown > 0 && (!scope || scope.includes(r.location)));
    if (offered.length === 0) continue;
    looks++;
    if (e.visitor) visitors.add(e.visitor);
    const allGone = offered.every((r) => r.bookable === 0);
    if (allGone) nothingBookable++;
    const day = weekdays[parseISODate(e.props.date).getDay()];
    day.looks++;
    if (allGone) day.soldOut++;
    const d = dates.get(e.props.date) ?? { date: e.props.date, looks: 0, nothingBookable: 0 };
    d.looks++;
    if (allGone) d.nothingBookable++;
    dates.set(e.props.date, d);
    for (const r of offered) {
      const row = rooms.get(r.roomId) ?? { label: r.roomName, looks: 0, soldOut: 0 };
      row.looks++;
      if (r.bookable === 0) row.soldOut++;
      rooms.set(r.roomId, row);
    }
  }
  return {
    looks,
    visitors: visitors.size > 0 ? visitors.size : null,
    nothingBookable,
    byRoom: Array.from(rooms.values()).sort((a, b) => b.soldOut - a.soldOut || b.looks - a.looks),
    byWeekday: weekdays,
    topDates: Array.from(dates.values())
      .filter((d) => d.nothingBookable > 0)
      .sort((a, b) => b.nothingBookable - a.nothingBookable || b.looks - a.looks)
      .slice(0, 10),
  };
}

// --- Funnel -------------------------------------------------------------------

export const FUNNEL_STEPS: { kind: EventKind; label: string }[] = [
  { kind: "availability_look", label: "Looked at a date" },
  { kind: "add_to_cart", label: "Added a session" },
  { kind: "begin_checkout", label: "Started checkout" },
  { kind: "checkout_details", label: "Entered their details" },
  { kind: "payment_started", label: "Went to pay" },
  { kind: "purchase", label: "Booked" },
];

export type FunnelStep = {
  kind: EventKind;
  label: string;
  count: number; // unique visitors when ids exist, else raw events
  ofPrevious: number | null; // share of the step before, 0–1
  ofFirst: number | null; // share of the top of the funnel, 0–1
};
export type Funnel = { steps: FunnelStep[]; byVisitor: boolean; abandonedCarts: number | null };

// Where people stop. Counted as unique visitors per step once the cookie is
// in the data; before that, as events, and labelled so. Abandoned carts are
// visitors who added a session and never booked — only knowable per visitor.
export function funnel(events: SiteEvent[]): Funnel {
  const byVisitor = events.some((e) => e.visitor);
  const perStep = new Map<EventKind, Set<string> | number>();
  for (const step of FUNNEL_STEPS) perStep.set(step.kind, byVisitor ? new Set<string>() : 0);
  for (const e of events) {
    const cur = perStep.get(e.kind);
    if (cur === undefined) continue;
    if (cur instanceof Set) {
      if (e.visitor) cur.add(e.visitor);
    } else perStep.set(e.kind, cur + 1);
  }
  const counts = FUNNEL_STEPS.map((s) => {
    const v = perStep.get(s.kind)!;
    return v instanceof Set ? v.size : v;
  });
  const steps: FunnelStep[] = FUNNEL_STEPS.map((s, i) => ({
    ...s,
    count: counts[i],
    ofPrevious: i === 0 ? null : counts[i - 1] ? counts[i] / counts[i - 1] : null,
    ofFirst: i === 0 ? null : counts[0] ? counts[i] / counts[0] : null,
  }));
  let abandonedCarts: number | null = null;
  if (byVisitor) {
    const added = perStep.get("add_to_cart") as Set<string>;
    const bought = perStep.get("purchase") as Set<string>;
    abandonedCarts = Array.from(added).filter((v) => !bought.has(v)).length;
  }
  return { steps, byVisitor, abandonedCarts };
}
