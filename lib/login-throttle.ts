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
//
// Sign-ins overlap: serverless runs a burst of them side by side, and every
// login's count shares the one settings row. So an attempt is counted BEFORE
// its password is checked, and every write is a compare-and-swap on the row's
// updated_at. A plain read-then-save let fifty parallel guesses all pass the
// lock check and then overwrite each other's counts, so the limit never tripped.
import { rest } from "./supabase";

const KEY = "login_attempts";

export const MAX_FAILURES = 5; // failures allowed inside the window
export const WINDOW_MINUTES = 15; // failures older than this are forgotten
export const LOCK_MINUTES = 15; // how long a lock lasts once tripped

// How many times a write is retried after another sign-in changed the row
// first. Once a login is locked, further attempts only read, so a burst stops
// contending almost as soon as it trips the lock.
const MAX_TRIES = 8;

type Attempt = {
  // Attempts inside the window not yet wiped by a correct password. Counted as
  // each attempt starts, so a burst can't all slip in under the limit.
  failures: number;
  firstAt: string; // ISO, when the current run of failures started
  lockedUntil?: string; // ISO
};

type State = Record<string, Attempt>;

type Snapshot = { state: State; exists: boolean; version: string | null };

function keyFor(email: string, ip: string): string {
  const cleanEmail = email.trim().toLowerCase().slice(0, 200);
  // No usable IP (local dev, an odd proxy) falls back to the email on its own:
  // rate limiting that still works beats one that quietly stops counting.
  const cleanIp = ip.trim().slice(0, 60) || "unknown";
  return `${cleanEmail}|${cleanIp}`;
}

// The row plus its updated_at, which is the version a write is conditional on.
async function readState(): Promise<Snapshot | null> {
  try {
    const res = await rest(`settings?key=eq.${KEY}&select=value,updated_at&limit=1`);
    if (!res.ok) return null; // settings unreachable — callers fail open, see below
    const [row] = (await res.json()) as { value: State | null; updated_at: string | null }[];
    if (!row) return { state: {}, exists: false, version: null };
    const state = row.value && typeof row.value === "object" ? row.value : {};
    return { state, exists: true, version: row.updated_at ?? null };
  } catch {
    return null;
  }
}

// Saves `next` only if the row is still the one that was read. "lost" means
// another sign-in wrote in between and the caller should re-read and retry.
async function writeIfUnchanged(read: Snapshot, next: State): Promise<"written" | "lost" | "failed"> {
  // Strictly later than the version read, so the version moves even when two
  // writes land inside one millisecond.
  const previous = read.version ? Date.parse(read.version) : NaN;
  const stamp = new Date(Number.isFinite(previous) ? Math.max(Date.now(), previous + 1) : Date.now()).toISOString();
  try {
    let res: Response;
    if (read.exists) {
      const guard = read.version === null ? "is.null" : `eq.${encodeURIComponent(read.version)}`;
      res = await rest(`settings?key=eq.${KEY}&updated_at=${guard}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ value: next, updated_at: stamp }),
      });
    } else {
      // First write ever: insert, but never over a row another sign-in just
      // created (ignore-duplicates returns nothing in that case).
      res = await rest("settings?on_conflict=tenant_id,key", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify([{ key: KEY, value: next, updated_at: stamp }]),
      });
    }
    if (!res.ok) return "failed";
    return ((await res.json()) as unknown[]).length > 0 ? "written" : "lost";
  } catch {
    return "failed";
  }
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 50));

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

// Counts this sign-in attempt and says whether its password may be checked.
// MAX_FAILURES attempts inside the window go through; the next one locks the
// login and is refused, as is everything until the lock runs out. `busy` means
// the count couldn't be recorded because the row kept changing underneath —
// a burst in progress — and the attempt is refused rather than let through
// uncounted.
//
// Fails OPEN: if the settings table can't be read or written, staff can still
// sign in. A venue locked out of its own booking system because a side table is
// unavailable is a worse outcome than an attacker getting their attempts back,
// and the password check itself is unaffected either way.
export async function claimLoginAttempt(
  email: string,
  ip: string
): Promise<{ locked: boolean; minutesLeft: number; busy: boolean }> {
  const open = { locked: false, minutesLeft: 0, busy: false };
  const key = keyFor(email, ip);
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const read = await readState();
    if (!read) return open;
    const now = Date.now();
    const previous = read.state[key];

    const msLeft = previous?.lockedUntil ? Date.parse(previous.lockedUntil) - now : 0;
    if (msLeft > 0) return { locked: true, minutesLeft: Math.max(1, Math.ceil(msLeft / 60_000)), busy: false };

    const withinWindow = previous && now - Date.parse(previous.firstAt) < WINDOW_MINUTES * 60_000;
    const entry: Attempt = withinWindow
      ? { failures: previous.failures + 1, firstAt: previous.firstAt }
      : { failures: 1, firstAt: new Date(now).toISOString() };
    const locking = entry.failures > MAX_FAILURES;
    if (locking) entry.lockedUntil = new Date(now + LOCK_MINUTES * 60_000).toISOString();

    const outcome = await writeIfUnchanged(read, prune({ ...read.state, [key]: entry }, now));
    if (outcome === "failed") return open;
    if (outcome === "written") {
      return locking ? { locked: true, minutesLeft: LOCK_MINUTES, busy: false } : open;
    }
    await pause();
  }
  return { locked: false, minutesLeft: 0, busy: true };
}

// Wipes the count after a correct password, so ordinary mistyping never
// accumulates towards a lock across days.
export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  const key = keyFor(email, ip);
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const read = await readState();
    if (!read || !read.state[key]) return;
    const next = { ...read.state };
    delete next[key];
    // Any failure here is not worth failing a successful sign-in over.
    if ((await writeIfUnchanged(read, prune(next, Date.now()))) !== "lost") return;
    await pause();
  }
}
