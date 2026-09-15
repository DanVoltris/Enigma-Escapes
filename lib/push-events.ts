// What phone notifications staff can get, and who gets each one.
//
// Kept free of server imports so the Notifications page can show the same list
// the sender uses, and so the rules can be tested without a database. The
// sending itself is lib/push.ts.
import type { Permission, StaffAccount } from "./permissions";

export const PUSH_EVENTS = [
  "request.new",
  "request.confirmed",
  "request.released",
  "booking.cancelled",
  "booking.rescheduled",
  "booking.new",
  "booking.walkin",
] as const;

export type PushEvent = (typeof PUSH_EVENTS)[number];

// `permission` is what the account must already have to be offered the alert:
// a notification is a view into the portal, so it can't show more than the
// portal would. `on` is the default for someone who has never changed it: new
// requests (someone has to answer) and new online bookings are on; the rest are
// off until a person switches them on.
export const PUSH_EVENT_INFO: Record<PushEvent, { label: string; hint: string; permission: Permission; on: boolean }> = {
  "request.new": {
    label: "New booking requests",
    hint: "A customer asks for a session in the next few hours. Someone needs to accept or decline it.",
    permission: "requests",
    on: true,
  },
  "request.confirmed": {
    label: "Requests confirmed",
    hint: "The customer replied Y, or someone confirmed it at the desk.",
    permission: "requests",
    on: false,
  },
  "request.released": {
    label: "Requests released",
    hint: "The customer replied N, or didn't reply in time and the spot went back on sale.",
    permission: "requests",
    on: false,
  },
  "booking.cancelled": {
    label: "Customer cancellations",
    hint: "A customer cancels their own booking from their link.",
    permission: "bookings.view",
    on: false,
  },
  "booking.rescheduled": {
    label: "Customer reschedules",
    hint: "A customer moves their own booking to another time.",
    permission: "bookings.view",
    on: false,
  },
  "booking.new": {
    label: "New online bookings",
    hint: "Every booking made on the website. Busy days bring a lot of these.",
    permission: "bookings.view",
    on: true,
  },
  "booking.walkin": {
    label: "Walk-ins",
    hint: "A booking taken at the desk by someone else.",
    permission: "bookings.view",
    on: false,
  },
};

export type PushPrefs = Record<PushEvent, boolean>;

// Whatever is stored (or nothing) → a full set. Unknown keys are dropped and
// missing ones take the default, so adding an alert type later needs no data
// change: everyone simply gets its default until they choose otherwise.
export function normalizePrefs(stored: unknown): PushPrefs {
  const src = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const out = {} as PushPrefs;
  for (const e of PUSH_EVENTS) {
    out[e] = typeof src[e] === "boolean" ? (src[e] as boolean) : PUSH_EVENT_INFO[e].on;
  }
  return out;
}

// The alerts this account can be offered at all.
export function eventsFor(staff: Pick<StaffAccount, "permissions">): PushEvent[] {
  return PUSH_EVENTS.filter((e) => staff.permissions.includes(PUSH_EVENT_INFO[e].permission));
}

// Does this person get this alert? Active, allowed to see it, switched on, and
// covering one of the locations it's about. Same location rule as the portal
// (lib/auth.ts allowedLocations): admins and unscoped accounts see everywhere.
export function wantsAlert(
  staff: Pick<StaffAccount, "id" | "role" | "locations" | "permissions" | "active">,
  prefs: PushPrefs,
  alert: { event: PushEvent; locations: string[]; exceptStaffId?: string }
): boolean {
  if (!staff.active) return false;
  if (alert.exceptStaffId && staff.id === alert.exceptStaffId) return false;
  if (!staff.permissions.includes(PUSH_EVENT_INFO[alert.event].permission)) return false;
  if (!prefs[alert.event]) return false;
  const everywhere = staff.role === "admin" || staff.locations.length === 0;
  if (everywhere || alert.locations.length === 0) return true;
  return alert.locations.some((l) => staff.locations.includes(l));
}

// The push services the browsers actually use. A subscription is a URL the
// server will POST to, so without this a signed-in account could point it at
// anything — including addresses inside the hosting network.
const PUSH_HOSTS = [
  "push.apple.com", // Safari and home-screen web apps on iPhone, iPad and Mac
  "fcm.googleapis.com", // Chrome, Samsung Internet, most Android browsers
  "push.services.mozilla.com", // Firefox
  "notify.windows.com", // Edge
];

export function pushEndpointProblem(endpoint: unknown): string | null {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return "That notification address isn't valid.";
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "That notification address isn't valid.";
  }
  if (url.protocol !== "https:") return "That notification address isn't valid.";
  const host = url.hostname.toLowerCase();
  if (!PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return "This browser's notification service isn't supported. Use Safari on iPhone or Chrome on Android.";
  }
  return null;
}

// A name a person recognises in a device list: "iPhone", not a user agent.
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows computer";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Linux/.test(ua)) return "Linux computer";
  return "Unknown device";
}

// A phone that hasn't opened the app in this long gets one reminder to.
export const NUDGE_AFTER_DAYS = 14;

// Should this device get the "open the app now and then" reminder? Once per
// quiet spell: opening the app moves last_seen past the nudge, which re-arms it.
export function needsNudge(
  device: { last_seen_at: string; nudged_at: string | null; stopped_at: string | null },
  now: number
): boolean {
  if (device.stopped_at) return false;
  const seen = Date.parse(device.last_seen_at);
  if (!Number.isFinite(seen) || now - seen < NUDGE_AFTER_DAYS * 86_400_000) return false;
  return !device.nudged_at || Date.parse(device.nudged_at) < seen;
}
