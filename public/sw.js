// The staff portal's service worker. It exists for one thing: showing phone
// notifications (lib/push.ts sends them) and opening the right page when one is
// tapped. It deliberately has no fetch handler — nothing is cached, and every
// page on the site, customer or staff, loads exactly as it would without it.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  // iPhones require every push to show a notification, so there is always one,
  // even for a message that arrived empty.
  event.waitUntil(
    self.registration.showNotification(data.title || "Staff portal", {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag), // a replaced notification still buzzes
      icon: "/staff-icon/192",
      data: { url: data.url || "/manager" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/manager", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse the app if it's already open rather than stacking another copy.
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) {
          try {
            await client.navigate(url);
            return;
          } catch {
            // Not controlled by this worker yet; fall through to opening a window.
          }
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});

// The push service renewed this phone's address. Tell the server, or alerts
// would keep going to the old one and bounce. Sent without relying on being
// signed in: the old address is what proves which phone this is.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const next =
        event.newSubscription ||
        (old && old.options ? await self.registration.pushManager.subscribe(old.options) : null);
      if (!next) return;
      await fetch("/api/manager/push/subscription", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: next.toJSON(), replaces: old ? old.endpoint : null }),
      });
    })()
  );
});
