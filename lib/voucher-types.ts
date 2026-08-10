// Pure voucher types and rules — no database imports, so client components can
// use these without dragging the server-only Supabase/fs layer into the browser
// bundle. (Same split as site-settings-defaults.ts.)

export type RedemptionType = "value" | "spaces";
export type ItemsScope = "all" | "selected";
export type DateOption = "any" | "range";
export type TimeOption = "any" | "range";

export type Voucher = {
  code: string;
  faceCents: number; // value when issued
  remainingCents: number; // still spendable
  active: boolean;
  createdAt: string;
  purchaser: string | null; // who bought/created it
  email: string | null;
  message: string | null; // gift message, when one was written
  lastUsedAt: string | null;

  // Redemption rules (defaults mirror the old system: a plain dollar balance,
  // good on anything, any day, any time, never expiring).
  redemptionType: RedemptionType;
  spacesTotal: number | null; // when redeeming by seats rather than dollars
  spacesLeft: number | null;
  oneTimeUse: boolean; // spend it once, any leftover is forfeited
  itemsScope: ItemsScope;
  itemIds: string[]; // experience ids, when scope is "selected"
  dateOption: DateOption;
  dateFrom: string | null; // YYYY-MM-DD
  dateTo: string | null;
  timeOption: TimeOption;
  timeFrom: string | null; // HH:MM
  timeTo: string | null;
  daysOfWeek: number[]; // 0 = Sunday … 6 = Saturday
  exclusionDates: string[]; // YYYY-MM-DD the voucher can't be used on
  expiryDate: string | null; // null = no expiry
};

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// What a voucher is being spent on. Times are "HH:MM" 24h, dates YYYY-MM-DD.
export type RedeemContext = {
  date?: string | null; // session date
  time?: string | null; // session start
  roomId?: string | null; // experience being booked
  today?: string; // for expiry — injected so this stays pure
};

// Returns a plain-language reason the voucher can't be used, or null if it can.
// Every rule on the voucher screen is checked here, and this same function runs
// server-side at redemption, so the settings are real rules and not decoration.
export function voucherProblem(v: Voucher, ctx: RedeemContext = {}): string | null {
  if (!v.active) return "This voucher is inactive.";

  if (v.redemptionType === "spaces") {
    if ((v.spacesLeft ?? 0) <= 0) return "This voucher has no spaces left.";
  } else if (v.remainingCents <= 0) {
    return "This voucher has no balance left.";
  }

  const today = ctx.today;
  if (v.expiryDate && today && v.expiryDate < today) {
    return `This voucher expired on ${v.expiryDate}.`;
  }

  const date = ctx.date;
  if (date) {
    if (v.dateOption === "range") {
      if (v.dateFrom && date < v.dateFrom) return `Only valid for sessions from ${v.dateFrom}.`;
      if (v.dateTo && date > v.dateTo) return `Only valid for sessions up to ${v.dateTo}.`;
    }
    if (v.exclusionDates.includes(date)) return `Not valid on ${date}.`;
    // Parse as UTC so the weekday never shifts with the server's timezone.
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (!v.daysOfWeek.includes(dow)) return `Not valid on ${DAY_LABELS[dow]}s.`;
  }

  const time = ctx.time;
  if (time && v.timeOption === "range") {
    if (v.timeFrom && time < v.timeFrom) return `Only valid for sessions from ${v.timeFrom}.`;
    if (v.timeTo && time > v.timeTo) return `Only valid for sessions up to ${v.timeTo}.`;
  }

  if (v.itemsScope === "selected" && ctx.roomId && !v.itemIds.includes(ctx.roomId)) {
    return "Not valid for that experience.";
  }
  return null;
}

// Totals for the summary strip. Outstanding balance is what the business still
// owes in unredeemed vouchers — the number worth watching.
export function voucherTotals(vouchers: Voucher[]) {
  let face = 0;
  let outstanding = 0;
  let live = 0;
  for (const v of vouchers) {
    face += v.faceCents;
    if (v.active) {
      outstanding += v.remainingCents;
      if (v.remainingCents > 0) live += 1;
    }
  }
  return { face, outstanding, live, total: vouchers.length };
}
