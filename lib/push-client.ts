// Browser side of phone notifications: registering the service worker,
// subscribing this phone, and reporting it to the server. Shared by the
// Notifications page and the reconnect banner in the portal layout.

const SW_URL = "/sw.js";
// Set on a phone where someone turned notifications on, so that if they later
// vanish (the phone dropped them) the portal knows to say so. Only a hint: a
// cleared browser just means no banner, never a wrong alert.
const FLAG = "vb-push-on";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPads report themselves as a Mac; the touch screen gives them away.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

// Opened from the home-screen icon, rather than in a browser tab.
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function flagOn(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

export function setFlag(on: boolean): void {
  try {
    if (on) localStorage.setItem(FLAG, "1");
    else localStorage.removeItem(FLAG);
  } catch {
    // Private mode or storage blocked: the banner just won't know.
  }
}

// The VAPID public key arrives base64url; subscribe() wants the raw bytes.
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function post(url: string, method: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "That didn't work. Please try again.");
  return data;
}

// Subscribe this phone and tell the server. Asks for permission if it hasn't
// been given, which on an iPhone only works straight from a tap.
export async function turnOn(publicKey: string, replaces?: string | null): Promise<string> {
  if (Notification.permission !== "granted") {
    const answer = await Notification.requestPermission();
    if (answer !== "granted") {
      throw new Error(
        answer === "denied"
          ? "Notifications are blocked for this app. Allow them in your phone's settings, then try again."
          : "Notifications weren't allowed. Tap the button again and choose Allow."
      );
    }
  }
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  // subscribe() hands back the subscription the phone already holds, and when
  // this is a reconnect that one is dead. Always start from a fresh one.
  const held = await reg.pushManager.getSubscription();
  if (held) {
    replaces = replaces ?? held.endpoint;
    await held.unsubscribe().catch(() => false);
  }
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const data = await post("/api/manager/push/subscription", "POST", { subscription: sub.toJSON(), replaces: replaces ?? null });
  setFlag(true);
  return String(data.id ?? "");
}

export async function turnOff(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) {
    await post("/api/manager/push/subscription", "DELETE", { endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => false);
  }
  setFlag(false);
}

// The portal was opened here. Returns what the server knows about this phone.
export async function reportSeen(sub: PushSubscription): Promise<{ status: string; id: string | null }> {
  const data = await post("/api/manager/push/seen", "POST", { endpoint: sub.endpoint });
  return { status: String(data.status ?? "error"), id: typeof data.id === "string" ? data.id : null };
}

// Swap a dead subscription for a fresh one, without asking the person anything.
// Works where the browser allows subscribing outside a tap (Android always;
// iPhones usually, once permission is granted); throws where it doesn't, and
// the caller shows a button instead.
export async function reconnect(publicKey: string): Promise<string> {
  if (Notification.permission !== "granted") throw new Error("Permission needed");
  return turnOn(publicKey);
}
