// The dates on a promo code (migration 0022). Two separate things, both
// optional, both inclusive, both plain "YYYY-MM-DD" days in the venue's time:
//
//   use   — when the code can be typed in: a Black Friday sale taken Nov 27–29,
//           for a game whenever. Checked against today when the code is applied.
//   play  — which games it discounts: only sessions played Nov 27–29, whenever
//           they're booked. Works like a room limit (migration 0019): on a
//           booking that mixes dates only those sessions come off, and a booking
//           with none of them is refused the code.
//
// Pure — the checkout, the desk and the server all use it.

export const PROMO_DATES_MIGRATION =
  "Dates on a promo code need migration 0022 (promo dates) on this venue's database first.";

// A column-missing error from the database, for the migration message above.
export function isPromoDatesColumnError(err: unknown): boolean {
  return err instanceof Error && /use_from|use_until|play_from|play_until/.test(err.message);
}

// "usable Nov 27–29; games played Nov 27–29" for the activity log and lists.
export function promoDatesSummary(p: {
  useFrom?: string | null;
  useUntil?: string | null;
  playFrom?: string | null;
  playUntil?: string | null;
}): string {
  const parts: string[] = [];
  const use = dateRangeLabel(p.useFrom, p.useUntil);
  if (use) parts.push(`usable ${use}`);
  const play = dateRangeLabel(p.playFrom, p.playUntil);
  if (play) parts.push(`games played ${play}`);
  return parts.join("; ");
}

// Which sessions a promo code discounts. roomIds empty = every room; a missing
// end = open on that side.
export type PromoScope = {
  roomIds: readonly string[];
  playFrom?: string | null;
  playUntil?: string | null;
};

// computeTotals and friends have always taken a bare list of room ids; a scope
// with dates is the same thing with more to say.
export function toScope(scope: readonly string[] | PromoScope | null | undefined): PromoScope {
  if (!scope) return { roomIds: [] };
  if (Array.isArray(scope)) return { roomIds: scope as readonly string[] };
  return scope as PromoScope;
}

export function promoLimited(scope: readonly string[] | PromoScope): boolean {
  const s = toScope(scope);
  return s.roomIds.length > 0 || !!s.playFrom || !!s.playUntil;
}

// Whether a session is one the code discounts. A session with no date (only
// ever a caller that knows rooms alone) can't be in a date limit.
export function promoCovers(
  scope: readonly string[] | PromoScope,
  item: { roomId: string; date?: string }
): boolean {
  const s = toScope(scope);
  if (s.roomIds.length > 0 && !s.roomIds.includes(item.roomId)) return false;
  if (s.playFrom || s.playUntil) {
    if (!item.date) return false;
    if (s.playFrom && item.date < s.playFrom) return false;
    if (s.playUntil && item.date > s.playUntil) return false;
  }
  return true;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Nov 27" — read straight off the string, so no timezone can move the day.
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}`;
}

// "on Nov 27", "Nov 27–29", "Nov 30 – Dec 2", "from Nov 27", "until Nov 29".
// Empty when there are no dates.
export function dateRangeLabel(from?: string | null, until?: string | null): string {
  if (from && until) {
    if (from === until) return `on ${shortDate(from)}`;
    const sameMonth = from.slice(0, 7) === until.slice(0, 7);
    return sameMonth
      ? `${shortDate(from)}–${Number(until.slice(8, 10))}`
      : `${shortDate(from)} – ${shortDate(until)}`;
  }
  if (from) return `from ${shortDate(from)}`;
  if (until) return `until ${shortDate(until)}`;
  return "";
}

// Why a code can't be used today, or null when it can.
export function promoUseProblem(
  promo: { code: string; useFrom?: string | null; useUntil?: string | null },
  today: string
): string | null {
  if (promo.useFrom && today < promo.useFrom) {
    return `${promo.code} can be used ${dateRangeLabel(promo.useFrom, promo.useUntil)}.`;
  }
  if (promo.useUntil && today > promo.useUntil) {
    return `${promo.code} ended on ${shortDate(promo.useUntil)}.`;
  }
  return null;
}

// "School of Sorcery or Time Heist" — names, not ids.
function roomList(roomNames: readonly string[]): string {
  return roomNames.length <= 1
    ? roomNames[0] ?? "certain rooms"
    : `${roomNames.slice(0, -1).join(", ")} or ${roomNames[roomNames.length - 1]}`;
}

// What the code covers, for the line under an applied code and the refusal:
// "School of Sorcery, games played Nov 27–29". Empty for an unlimited code.
export function promoScopeLabel(scope: PromoScope, roomNames: readonly string[]): string {
  const parts: string[] = [];
  if (scope.roomIds.length > 0) parts.push(roomList(roomNames));
  const dates = dateRangeLabel(scope.playFrom, scope.playUntil);
  if (dates) parts.push(`games played ${dates}`);
  return parts.join(", ");
}

// The refusal for a booking with nothing the code covers, or null when it has
// something. "BLACKFRIDAY only works for games played Nov 27–29."
export function promoMissMessage(
  code: string,
  scope: readonly string[] | PromoScope,
  items: readonly { roomId: string; date?: string }[],
  roomNames: readonly string[]
): string | null {
  const s = toScope(scope);
  if (!promoLimited(s) || items.some((i) => promoCovers(s, i))) return null;
  const dates = dateRangeLabel(s.playFrom, s.playUntil);
  if (s.roomIds.length > 0) {
    return `${code} only works on ${roomList(roomNames)}${dates ? `, for games played ${dates}` : ""}.`;
  }
  return `${code} only works for games played ${dates}.`;
}

// A date typed into the portal: "" / null clears it, anything else must be a
// real YYYY-MM-DD day.
export function parsePromoDate(raw: unknown): { value: string | null } | { error: string } {
  if (raw === undefined || raw === null || raw === "") return { value: null };
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: "Dates must be real days." };
  const d = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return { error: "Dates must be real days." };
  return { value: raw };
}

// Both ranges from a request body, checked: each end a real day, and no range
// that ends before it starts.
export function parsePromoDates(d: {
  useFrom?: unknown;
  useUntil?: unknown;
  playFrom?: unknown;
  playUntil?: unknown;
}):
  | { useFrom: string | null; useUntil: string | null; playFrom: string | null; playUntil: string | null }
  | { error: string } {
  const out: Record<string, string | null> = {};
  for (const key of ["useFrom", "useUntil", "playFrom", "playUntil"] as const) {
    const parsed = parsePromoDate(d[key]);
    if ("error" in parsed) return parsed;
    out[key] = parsed.value;
  }
  if (out.useFrom && out.useUntil && out.useUntil < out.useFrom) {
    return { error: "The last day the code can be used is before the first." };
  }
  if (out.playFrom && out.playUntil && out.playUntil < out.playFrom) {
    return { error: "The last game date is before the first." };
  }
  return out as { useFrom: string | null; useUntil: string | null; playFrom: string | null; playUntil: string | null };
}

// The scope of a promo code as stored.
export function promoScopeOf(promo: {
  roomIds: readonly string[];
  playFrom?: string | null;
  playUntil?: string | null;
}): PromoScope {
  return { roomIds: promo.roomIds, playFrom: promo.playFrom ?? null, playUntil: promo.playUntil ?? null };
}

// The scope a booking's promo was sold with — its own copy, since the code may
// since have changed or gone.
export function bookingPromoScope(pricing: {
  promoRoomIds?: string[];
  promoPlayFrom?: string;
  promoPlayUntil?: string;
}): PromoScope {
  return {
    roomIds: pricing.promoRoomIds ?? [],
    playFrom: pricing.promoPlayFrom ?? null,
    playUntil: pricing.promoPlayUntil ?? null,
  };
}

// The fields that remember a scope on a booking's pricing; only what's set.
export function scopePricingFields(scope: PromoScope): {
  promoRoomIds?: string[];
  promoPlayFrom?: string;
  promoPlayUntil?: string;
} {
  return {
    ...(scope.roomIds.length > 0 ? { promoRoomIds: [...scope.roomIds] } : {}),
    ...(scope.playFrom ? { promoPlayFrom: scope.playFrom } : {}),
    ...(scope.playUntil ? { promoPlayUntil: scope.playUntil } : {}),
  };
}
