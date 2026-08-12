// The 20%-off code a customer is texted the moment they book, to spend on a
// later visit. Distinct from promo_codes (shared codes staff hand out) and
// gift_vouchers (a prepaid dollar balance): a reward is minted by the system,
// belongs to one phone number, and is tied to the booking that earned it.
//
// That tie is the whole point. Cancel the booking that earned it and the
// reward dies with it — including retrospectively, if it has already been
// spent, so nobody books, claims the discount, then cancels the first visit.
import { rest, restError } from "./supabase";

export const REWARD_PERCENT_OFF = 20;

export type RewardStatus = "active" | "used" | "revoked";

export type RewardCode = {
  code: string;
  percentOff: number;
  earnedBooking: string;
  customerPhone: string;
  // The start of the earning booking's first session. The reward has to be
  // spent before then, and only on a session later than it.
  validUntil: string; // ISO timestamp
  usedBooking: string | null;
  status: RewardStatus;
  createdAt: string;
};

type Row = {
  code: string;
  percent_off: number;
  earned_booking: string;
  customer_phone: string;
  valid_until: string;
  used_booking: string | null;
  status: string;
  created_at: string;
};

function toReward(r: Row): RewardCode {
  return {
    code: r.code,
    percentOff: r.percent_off,
    earnedBooking: r.earned_booking,
    customerPhone: r.customer_phone,
    validUntil: r.valid_until,
    usedBooking: r.used_booking,
    status: r.status === "used" ? "used" : r.status === "revoked" ? "revoked" : "active",
    createdAt: r.created_at,
  };
}

// Digits only, so "(204) 990-6530" and "2049906530" are the same person. The
// reward is locked to a phone number and customers never type it back the same
// way twice.
export function normalizePhone(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789"; // no O/0, I/1, S/5 — read aloud over the phone

function block(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

async function codeExists(code: string): Promise<boolean> {
  const res = await rest(`reward_codes?code=eq.${encodeURIComponent(code)}&select=code&limit=1`);
  if (!res.ok) throw await restError(res, "Checking that reward code");
  return ((await res.json()) as unknown[]).length > 0;
}

async function generateCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = `NEXT20-${block(5)}`;
    if (!(await codeExists(code))) return code;
  }
  throw new Error("Could not generate a unique reward code");
}

export async function getRewardCode(code: string): Promise<RewardCode | undefined> {
  const res = await rest(`reward_codes?code=eq.${encodeURIComponent(code)}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Looking up that reward code");
  const rows = (await res.json()) as Row[];
  return rows[0] ? toReward(rows[0]) : undefined;
}

export async function rewardForBooking(bookingId: string): Promise<RewardCode | undefined> {
  const res = await rest(`reward_codes?earned_booking=eq.${encodeURIComponent(bookingId)}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Looking up that booking's reward");
  const rows = (await res.json()) as Row[];
  return rows[0] ? toReward(rows[0]) : undefined;
}

// Mints the reward for a booking, exactly once. earned_booking is unique, so
// when the Stripe webhook and the customer's return both land here the loser
// reads back the winner's code instead of issuing a second one.
export async function mintRewardFor(booking: {
  id: string;
  customer: { phone: string };
  items: { date: string; time: string }[];
}): Promise<{ reward: RewardCode; created: boolean } | undefined> {
  const existing = await rewardForBooking(booking.id);
  if (existing) return { reward: existing, created: false };

  const phone = normalizePhone(booking.customer.phone);
  if (!phone) return undefined; // nothing to text, nothing to lock it to

  // Dies when the first session of this booking starts.
  const starts = booking.items
    .map((i) => `${i.date}T${i.time}:00`)
    .sort();
  if (starts.length === 0) return undefined;
  const validUntil = new Date(starts[0]).toISOString();

  const code = await generateCode();
  const res = await rest("reward_codes?on_conflict=earned_booking", {
    method: "POST",
    // return=representation is what makes the race safe to text on: the loser
    // of a duplicate insert gets 0 rows back, so only the winner sends the SMS.
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      code,
      percent_off: REWARD_PERCENT_OFF,
      earned_booking: booking.id,
      customer_phone: phone,
      valid_until: validUntil,
      status: "active",
      created_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw await restError(res, "Creating that reward code");
  const inserted = (await res.json()) as Row[];
  if (inserted[0]) return { reward: toReward(inserted[0]), created: true };
  // Lost the race — read back whichever code actually landed, and stay quiet.
  const landed = await rewardForBooking(booking.id);
  return landed ? { reward: landed, created: false } : undefined;
}

export type RewardContext = {
  phone?: string;
  // Start of the earliest session being booked now, as `YYYY-MM-DDTHH:MM:SS`.
  sessionStart?: string;
  now?: Date;
};

// Every rule in one place, so the checkout preview and the booking endpoint
// can never disagree about whether a code is good.
export function rewardProblem(r: RewardCode, ctx: RewardContext = {}): string | null {
  if (r.status === "used") return "That code has already been used.";
  if (r.status === "revoked") {
    return "That code is no longer valid — the booking that earned it was cancelled.";
  }
  if (ctx.phone !== undefined && normalizePhone(ctx.phone) !== r.customerPhone) {
    return "That code belongs to a different phone number.";
  }
  const dies = new Date(r.validUntil);
  const now = ctx.now ?? new Date();
  if (now >= dies) {
    return "That code has expired — it had to be used before your last visit started.";
  }
  if (ctx.sessionStart) {
    // Must be spent on a session LATER than the one that earned it: the reward
    // is for the next visit, not a cheaper version of a visit already booked.
    if (new Date(ctx.sessionStart) <= dies) {
      return "That code only works on a session after your existing booking.";
    }
  }
  return null;
}

// Marks the reward spent. Conditional on it still being active, so two
// checkouts racing the same code can't both claim the discount.
export async function markRewardUsed(code: string, bookingId: string): Promise<boolean> {
  const res = await rest(`reward_codes?code=eq.${encodeURIComponent(code)}&status=eq.active`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status: "used",
      used_booking: bookingId,
      used_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw await restError(res, "Applying that reward code");
  return ((await res.json()) as Row[]).length > 0;
}

// Kills the reward a cancelled booking earned. Returns the code and, when it
// had already been spent, the booking that now has to go back to full price.
export async function revokeRewardFor(
  bookingId: string
): Promise<{ code: string; usedBooking: string | null } | undefined> {
  const reward = await rewardForBooking(bookingId);
  if (!reward || reward.status === "revoked") return undefined;

  const res = await rest(`reward_codes?earned_booking=eq.${encodeURIComponent(bookingId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "revoked", revoked_at: new Date().toISOString() }),
  });
  if (!res.ok) throw await restError(res, "Revoking that reward code");
  return { code: reward.code, usedBooking: reward.usedBooking };
}
