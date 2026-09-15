// Phone notifications for staff (Web Push), sent alongside the texts, never
// instead of them.
//
// A staff member turns notifications on from the portal on their phone (the
// home-screen app on an iPhone, Chrome on Android). The browser hands back an
// address at Apple's or Google's push service; we store it against their
// account (push_subscriptions, migrations/0005) and POST encrypted messages to
// it. Their phone shows them on the lock screen and as a banner.
//
// Keys live in environment variables only: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// and, optionally, VAPID_SUBJECT (a mailto: or https: contact the push services
// can reach; defaults to the venue's site). Without the keys every send is a
// silent no-op, the same keys-later contract as Twilio and Stripe.
//
// Every message is about a room and a time, never a customer: lock screens are
// read by whoever is standing next to the phone.
import { after } from "next/server";
import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { needsNudge, normalizePrefs, wantsAlert, type PushEvent, type PushPrefs } from "./push-events";
import { getCompanyName, getSetting, saveSetting } from "./settings";
import { notifyPushStopped } from "./sms";
import { listStaff, type StaffAccount } from "./staff";
import { rest, restError } from "./supabase";

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY?.trim();
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY?.trim();

function vapidSubject(): string | null {
  const set = process.env.VAPID_SUBJECT?.trim();
  if (set) return set;
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return site ? `https://${site}` : null;
}

export function pushConfigured(): boolean {
  return Boolean(PUBLIC_KEY && PRIVATE_KEY && vapidSubject());
}

// The public half is what a phone subscribes with. Safe to hand to the browser.
export function pushPublicKey(): string | null {
  return pushConfigured() ? PUBLIC_KEY! : null;
}

// The venue's own address, for the link in a "notifications stopped" text when
// the caller has no request to read it from.
function siteOrigin(): string | null {
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return site ? `https://${site}` : null;
}

// ---------- devices ----------

export type PushDevice = {
  id: string;
  staff_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string | null;
  created_at: string;
  last_seen_at: string;
  last_delivered_at: string | null;
  nudged_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
  stop_texted_at: string | null;
};

// What the portal shows about a device. Leaves out the address and keys: those
// are what a message is sent with, and no screen needs them.
export type DeviceSummary = {
  id: string;
  staffId: string;
  device: string;
  addedAt: string;
  lastSeenAt: string;
  lastDeliveredAt: string | null;
  stoppedAt: string | null;
};

export function summarize(d: PushDevice): DeviceSummary {
  return {
    id: d.id,
    staffId: d.staff_id,
    device: d.device || "Unknown device",
    addedAt: d.created_at,
    lastSeenAt: d.last_seen_at,
    lastDeliveredAt: d.last_delivered_at,
    stoppedAt: d.stopped_at,
  };
}

// Empty rather than an error before migrations/0005 has run on a venue, so the
// portal keeps working and the feature is simply absent until it has.
export async function listDevices(filter = ""): Promise<PushDevice[]> {
  const res = await rest(`push_subscriptions?select=*&order=created_at.asc${filter}`);
  if (res.status === 404) return [];
  if (!res.ok) throw await restError(res, "Loading notification devices");
  return (await res.json()) as PushDevice[];
}

async function deviceByEndpoint(endpoint: string): Promise<PushDevice | undefined> {
  return (await listDevices(`&endpoint=eq.${encodeURIComponent(endpoint)}&limit=1`))[0];
}

async function patchDevices(ids: string[], patch: Partial<PushDevice>, extraFilter = ""): Promise<PushDevice[]> {
  if (ids.length === 0) return [];
  const res = await rest(`push_subscriptions?id=in.(${ids.map(encodeURIComponent).join(",")})${extraFilter}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await restError(res, "Updating notification devices");
  return (await res.json()) as PushDevice[];
}

// Turning notifications on (or back on) from a phone. One row per phone: the
// same phone subscribing again, or someone else signing in on it, updates the
// row it already has instead of adding a second that would double every alert.
export async function saveDevice(input: {
  staffId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string;
  replaces?: string | null;
}): Promise<PushDevice> {
  const now = new Date().toISOString();
  const fields = {
    staff_id: input.staffId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    device: input.device,
    last_seen_at: now,
    nudged_at: null,
    stopped_at: null,
    stop_reason: null,
    stop_texted_at: null,
  };
  if (input.replaces && input.replaces !== input.endpoint) {
    const old = await deviceByEndpoint(input.replaces);
    if (old && old.staff_id === input.staffId) await deleteDevice(old.id);
  }
  const existing = await deviceByEndpoint(input.endpoint);
  if (existing) {
    const [row] = await patchDevices([existing.id], fields);
    return row ?? { ...existing, ...fields };
  }
  const row = { id: randomUUID(), created_at: now, last_delivered_at: null, ...fields };
  const res = await rest("push_subscriptions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (res.status === 404) throw new Error("Phone notifications aren't set up on this venue's database yet (migration 0005).");
  if (!res.ok) throw await restError(res, "Saving the notification device");
  return row as PushDevice;
}

export async function deleteDevice(id: string): Promise<void> {
  const res = await rest(`push_subscriptions?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok) throw await restError(res, "Removing the notification device");
}

// The portal was opened on this phone. Moves last_seen (which is what the
// 14-day reminder measures) and moves the phone to whoever is signed in now.
// Says whether the phone is still receiving, so the page can reconnect it.
export async function markSeen(
  endpoint: string,
  staffId: string
): Promise<{ status: "ok" | "stopped" | "unknown"; id: string | null }> {
  const device = await deviceByEndpoint(endpoint);
  if (!device) return { status: "unknown", id: null };
  const patch: Partial<PushDevice> = { last_seen_at: new Date().toISOString() };
  if (device.staff_id !== staffId) patch.staff_id = staffId;
  await patchDevices([device.id], patch);
  return { status: device.stopped_at ? "stopped" : "ok", id: device.id };
}

// ---------- preferences ----------

export async function getPrefs(staffId: string): Promise<PushPrefs> {
  const res = await rest(`staff_accounts?id=eq.${encodeURIComponent(staffId)}&select=notify_prefs&limit=1`);
  if (!res.ok) return normalizePrefs(null); // column not there yet: defaults
  const rows = (await res.json()) as { notify_prefs?: unknown }[];
  return normalizePrefs(rows[0]?.notify_prefs);
}

async function allPrefs(): Promise<Map<string, PushPrefs>> {
  const res = await rest("staff_accounts?select=id,notify_prefs");
  const rows = res.ok ? ((await res.json()) as { id: string; notify_prefs?: unknown }[]) : [];
  return new Map(rows.map((r) => [r.id, normalizePrefs(r.notify_prefs)]));
}

export async function savePrefs(staffId: string, prefs: PushPrefs): Promise<void> {
  const res = await rest(`staff_accounts?id=eq.${encodeURIComponent(staffId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ notify_prefs: prefs }),
  });
  if (!res.ok) throw await restError(res, "Saving notification choices");
}

// ---------- sending ----------

export type PushMessage = {
  title: string;
  body: string;
  url: string; // where tapping it opens, e.g. /manager/requests
  // Same tag replaces the earlier notification rather than stacking, so a
  // request that gets confirmed doesn't leave "New request" sitting there too.
  tag?: string;
  // How long Apple or Google should keep trying a phone that's off. A request
  // alert is useless once the session has started; a cancellation isn't.
  ttlSeconds?: number;
  urgent?: boolean;
};

type Outcome = "sent" | "gone" | "failed";

async function sendTo(device: PushDevice, message: PushMessage): Promise<Outcome> {
  try {
    await webpush.sendNotification(
      { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
      JSON.stringify({ title: message.title, body: message.body, url: message.url, tag: message.tag }),
      {
        vapidDetails: { subject: vapidSubject()!, publicKey: PUBLIC_KEY!, privateKey: PRIVATE_KEY! },
        TTL: message.ttlSeconds ?? 86_400,
        urgency: message.urgent ? "high" : "normal",
        timeout: 10_000,
      }
    );
    return "sent";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    // 404/410 is the push service saying this phone's address no longer exists:
    // notifications were turned off, the app was removed, or the phone let it
    // lapse. Nothing sent to it will ever arrive again.
    if (status === 404 || status === 410) return "gone";
    const body = (err as { body?: string }).body;
    console.error(`push to ${device.device ?? "device"} ${device.id} failed (${status ?? "no response"}): ${String(body ?? err).slice(0, 200)}`);
    return "failed";
  }
}

// Sends to the given devices and does the bookkeeping: delivery time on the
// ones that took it, and "stopped" on the ones that are gone — with one text to
// each person who lost a phone, so they hear about it from something that still
// works.
async function deliver(devices: PushDevice[], message: PushMessage, staff: StaffAccount[], origin?: string) {
  const outcomes = await Promise.all(devices.map((d) => sendTo(d, message)));
  const sent = devices.filter((_, i) => outcomes[i] === "sent");
  const gone = devices.filter((_, i) => outcomes[i] === "gone");
  const now = new Date().toISOString();

  try {
    await patchDevices(sent.map((d) => d.id), { last_delivered_at: now });
    if (gone.length > 0) {
      await patchDevices(gone.map((d) => d.id), { stopped_at: now, stop_reason: "The phone's notification address expired" });
      await textAboutStopped(gone, staff, origin);
    }
  } catch (err) {
    console.error("recording push results failed:", err);
  }
  return {
    sent: sent.length,
    stopped: gone.length,
    failed: outcomes.filter((o) => o === "failed").length,
  };
}

async function textAboutStopped(gone: PushDevice[], staff: StaffAccount[], origin?: string): Promise<void> {
  // Claim before texting (only rows not already texted), so two alerts bouncing
  // off the same dead phone at once can't text the person twice.
  const claimed = await patchDevices(
    gone.map((d) => d.id),
    { stop_texted_at: new Date().toISOString() },
    "&stop_texted_at=is.null"
  );
  const byStaff = new Map<string, string[]>();
  for (const d of claimed) byStaff.set(d.staff_id, [...(byStaff.get(d.staff_id) ?? []), d.device || "a device"]);
  const company = await getCompanyName();
  for (const [staffId, devices] of byStaff) {
    const person = staff.find((s) => s.id === staffId);
    if (!person?.active || !person.phone?.trim()) continue;
    await notifyPushStopped(person.phone, company, devices, origin ?? siteOrigin());
  }
}

// An alert for the team. Everyone whose account covers it, who has it switched
// on, gets it on every phone they've turned notifications on for.
export async function pushToStaff(
  alert: PushMessage & { event: PushEvent; locations: string[]; exceptStaffId?: string; origin?: string }
): Promise<void> {
  if (!pushConfigured()) return;
  try {
    const [staff, prefs, devices] = await Promise.all([listStaff(), allPrefs(), listDevices("&stopped_at=is.null")]);
    const wanted = new Set(
      staff.filter((s) => wantsAlert(s, prefs.get(s.id) ?? normalizePrefs(null), alert)).map((s) => s.id)
    );
    const targets = devices.filter((d) => wanted.has(d.staff_id));
    if (targets.length > 0) await deliver(targets, alert, staff, alert.origin);
  } catch (err) {
    console.error(`push alert ${alert.event} failed:`, err); // never break the caller
  }
  await nudgeIfDue(alert.origin);
}

// The "send a test" button: every phone this person has, whatever they've
// switched on, so they can check a phone before relying on it.
export async function pushTest(staffId: string, origin: string) {
  if (!pushConfigured()) return { sent: 0, stopped: 0, failed: 0, devices: 0 };
  const [staff, devices] = await Promise.all([
    listStaff(),
    listDevices(`&staff_id=eq.${encodeURIComponent(staffId)}&stopped_at=is.null`),
  ]);
  const result = await deliver(
    devices,
    {
      title: "Test notification",
      body: `Notifications from ${await getCompanyName()} are working on this phone.`,
      url: "/manager/notifications",
      tag: "test",
      ttlSeconds: 300,
      urgent: true,
    },
    staff,
    origin
  );
  return { ...result, devices: devices.length };
}

// Runs a push after the response has gone, so a customer never waits on Apple
// or Google to finish their booking. Outside a request (a script) it just runs.
export function pushLater(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

// ---------- the "open the app now and then" reminder ----------

// Phones can quietly stop delivering to a home-screen app that is never
// opened, and nobody finds out until an alert doesn't arrive. So a phone that
// hasn't opened the portal for NUDGE_AFTER_DAYS gets one notification asking
// it to — while notifications still reach it.
//
// No cron: like the request sweep (lib/request-flow.ts) it rides on ordinary
// traffic, doing real work at most once a day. The last run lives in settings
// because every serverless invocation is its own process.
const NUDGE_KEY = "push_nudged_at";
const NUDGE_EVERY_HOURS = 24;

export async function nudgeIfDue(origin?: string): Promise<void> {
  if (!pushConfigured()) return;
  try {
    const last = await getSetting<string>(NUDGE_KEY);
    if (last.value && Date.now() - Date.parse(last.value) < NUDGE_EVERY_HOURS * 3_600_000) return;
    await saveSetting(NUDGE_KEY, new Date().toISOString()); // claim first, as the request sweep does
    const now = Date.now();
    const quiet = (await listDevices("&stopped_at=is.null")).filter((d) => needsNudge(d, now));
    if (quiet.length === 0) return;
    const staff = await listStaff();
    const active = new Set(staff.filter((s) => s.active).map((s) => s.id));
    const targets = quiet.filter((d) => active.has(d.staff_id));
    await patchDevices(targets.map((d) => d.id), { nudged_at: new Date(now).toISOString() });
    await deliver(
      targets,
      {
        title: "Keep your alerts coming",
        body: `Open the ${await getCompanyName()} staff app now and then. Phones can stop notifications for apps that go unused.`,
        url: "/manager/notifications",
        tag: "nudge",
      },
      staff,
      origin
    );
  } catch (err) {
    console.error("notification reminder sweep failed:", err);
  }
}
