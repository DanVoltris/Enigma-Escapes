// Brute-force protection for the staff login. Passwords are hashed with scrypt,
// so this isn't about protecting the stored password — it's about stopping
// someone working through a weak one at internet speed. The portal is on the
// public web with a handful of accounts behind it, which is exactly the shape
// of thing a credential-stuffing script goes at.
//
// State lives in the settings table rather than in memory because the app runs
// serverless: a per-process Map would reset on every cold start and wouldn't be
// shared between instances, so an attacker would get a fresh allowance each
// time. Settings is a table that already exists, so this needs no migration.
//
// Attempts are recorded against the email as typed, whether or not an account
// exists. Locking only real accounts would turn the lockout message into a way
// of asking "is this a real login?", which the sign-in error text carefully
// avoids giving away.
//
// The count is per email AND per client IP, not per email alone. Keyed on the
// email by itself, anyone could lock the whole team out of their own portal
// during a shift by failing five times against each of six known logins —
// trading a break-in risk for an outage risk. Per IP, a scripted attack from
// one host still stops dead after five tries, and staff signing in from the
// venue are unaffected by it. Someone rotating IPs buys back attempts, which
// is the accepted cost of not handing out a way to lock the owners out.
import { getSetting, saveSetting } from "./settings";

const KEY = "login_attempts";

export const MAX_FAILURES = 5; // failures allowed inside the window
export const WINDOW_MINUTES = 15; // failures older than this are forgotten
export const LOCK_MINUTES = 15; // how long a lock lasts once tripped

type Attempt = {
  failures: number;
  firstAt: string; // ISO, when the current run of failures started
  lockedUntil?: string; // ISO
};

type State = Record<string, Attempt>;

function keyFor(email: string, ip: string): string {
  const cleanEmail = email.trim().toLowerCase().slice(0, 200);
  // No usable IP (local dev, an odd proxy) falls back to the email on its own:
  // rate limiting that still works beats one that quietly stops counting.
  const cleanIp = ip.trim().slice(0, 60) || "unknown";
  return `${cleanEmail}|${cleanIp}`;
}

async function readState(): Promise<State | null> {
  try {
    const { value } = await getSetting<State>(KEY);
    return value && typeof value === "object" ? value : {};
  } catch {
    return null; // settings unreachable — callers fail open, see below
  }
}

// Drops entries nobody is counting any more, so the row can't grow forever.
function prune(state: State, now: number): State {
  const out: State = {};
  for (const [email, a] of Object.entries(state)) {
    const locked = a.lockedUntil && Date.parse(a.lockedUntil) > now;
    const fresh = now - Date.parse(a.firstAt) < WINDOW_MINUTES * 60_000;
    if (locked || fresh) out[email] = a;
  }
  return out;
}

// Is this login currently locked out? Returns the minutes left when it is.
//
// Fails OPEN: if the settings table can't be read, staff can still sign in.
// A venue locked out of its own booking system because a side table is
// unavailable is a worse outcome than an attacker getting their attempts back,
// and the password check itself is unaffected either way.
export async function loginLock(email: string, ip: string): Promise<{ locked: boolean; minutesLeft: number }> {
  const state = await readState();
  if (!state) return { locked: false, minutesLeft: 0 };
  const entry = state[keyFor(email, ip)];
  if (!entry?.lockedUntil) return { locked: false, minutesLeft: 0 };
  const msLeft = Date.parse(entry.lockedUntil) - Date.now();
  if (msLeft <= 0) return { locked: false, minutesLeft: 0 };
  return { locked: true, minutesLeft: Math.max(1, Math.ceil(msLeft / 60_000)) };
}

// Counts one failed attempt, locking the login once MAX_FAILURES land inside
// the window. Never throws: a login that fails for the ordinary reason must
// still return its ordinary error even if recording the attempt didn't work.
export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  const now = Date.now();
  const state = await readState();
  if (!state) return;
  const key = keyFor(email, ip);
  const previous = state[key];
  const withinWindow = previous && now - Date.parse(previous.firstAt) < WINDOW_MINUTES * 60_000;

  const entry: Attempt = withinWindow
    ? { failures: previous.failures + 1, firstAt: previous.firstAt }
    : { failures: 1, firstAt: new Date(now).toISOString() };
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = new Date(now + LOCK_MINUTES * 60_000).toISOString();
  }

  const next = prune({ ...state, [key]: entry }, now);
  try {
    await saveSetting(KEY, next);
  } catch {
    // Settings unavailable. Nothing to do — the attempt goes uncounted rather
    // than turning a failed password into a 500.
  }
}

// Wipes the count after a correct password, so ordinary mistyping never
// accumulates towards a lock across days.
export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  const state = await readState();
  if (!state) return;
  const key = keyFor(email, ip);
  if (!state[key]) return;
  const next = { ...state };
  delete next[key];
  try {
    await saveSetting(KEY, prune(next, Date.now()));
  } catch {
    // Not worth failing a successful sign-in over.
  }
}
