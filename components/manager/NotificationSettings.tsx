"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTimestamp } from "@/lib/format";
import { PUSH_EVENT_INFO, type PushEvent, type PushPrefs } from "@/lib/push-events";
import {
  currentSubscription,
  isInstalledApp,
  isIOS,
  pushSupported,
  reportSeen,
  turnOff,
  turnOn,
} from "@/lib/push-client";
import type { DeviceSummary } from "@/lib/push";

// What this phone can do, worked out in the browser (the server can't know).
type PhoneState =
  | "checking"
  | "unsupported"
  | "ios-browser" // iPhone in Safari: only the home-screen app can get notifications
  | "blocked"
  | "off"
  | "on";

export default function NotificationSettings({
  publicKey,
  events,
  initialPrefs,
  devices,
}: {
  publicKey: string | null;
  events: PushEvent[];
  initialPrefs: PushPrefs;
  devices: DeviceSummary[];
}) {
  const router = useRouter();
  const [phone, setPhone] = useState<PhoneState>("checking");
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState(initialPrefs);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: PhoneState;
      if (isIOS() && !isInstalledApp()) next = "ios-browser";
      else if (!pushSupported()) next = "unsupported";
      else if (Notification.permission === "denied") next = "blocked";
      else {
        const sub = await currentSubscription().catch(() => null);
        next = "off";
        if (sub && publicKey) {
          const seen = await reportSeen(sub).catch(() => null);
          if (seen?.status === "ok" || seen?.status === "stopped") {
            next = seen.status === "ok" ? "on" : "off";
            if (!cancelled) setThisDeviceId(seen.id);
          }
        }
      }
      if (!cancelled) setPhone(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const enable = () =>
    run("enable", async () => {
      const id = await turnOn(publicKey!);
      setThisDeviceId(id || null);
      setPhone("on");
      setNotice("Notifications are on for this phone. Send a test to check it.");
      router.refresh();
    });

  const disable = () =>
    run("disable", async () => {
      await turnOff();
      setThisDeviceId(null);
      setPhone("off");
      setNotice("Notifications are off for this phone.");
      router.refresh();
    });

  const test = () =>
    run("test", async () => {
      const res = await fetch("/api/manager/push/test", { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        devices?: number;
        sent?: number;
        stopped?: number;
        failed?: number;
      };
      if (!res.ok) throw new Error(d.error ?? "Could not send the test.");
      if (!d.devices) throw new Error("None of your devices have notifications on yet.");
      const parts = [`Sent to ${d.sent} of ${d.devices} device${d.devices === 1 ? "" : "s"}.`];
      if (d.stopped) parts.push(`${d.stopped} had stopped receiving and ${d.stopped === 1 ? "is" : "are"} marked below.`);
      if (d.failed) parts.push(`${d.failed} couldn't be reached right now.`);
      setNotice(parts.join(" "));
      router.refresh();
    });

  const toggle = (event: PushEvent, on: boolean) =>
    run(event, async () => {
      setPrefs((p) => ({ ...p, [event]: on }));
      const res = await fetch("/api/manager/push/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, on }),
      });
      if (!res.ok) {
        setPrefs((p) => ({ ...p, [event]: !on }));
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? "Could not save that.");
      }
    });

  const remove = (d: DeviceSummary) =>
    run(`remove-${d.id}`, async () => {
      if (d.id === thisDeviceId) {
        await turnOff();
        setThisDeviceId(null);
        setPhone("off");
      } else {
        const res = await fetch(`/api/manager/push/devices/${d.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Could not remove that device.");
        }
      }
      setNotice(`${d.device} removed. It won't get notifications any more.`);
      router.refresh();
    });

  return (
    <>
      <div className="mgr-card">
        <h2>Notifications on this phone</h2>
        <p className="card-sub">
          Alerts on your lock screen and at the top of the screen, like any other app. They come as well as the texts,
          not instead of them.
        </p>
        {error && <div className="error-banner">{error}</div>}
        {notice && <p className="push-notice">{notice}</p>}

        {!publicKey ? (
          <p className="card-sub warn">
            Phone notifications aren&apos;t set up for this venue yet. An admin needs to add the notification keys to
            the site&apos;s settings on Vercel.
          </p>
        ) : phone === "checking" ? (
          <p className="card-sub">Checking this phone…</p>
        ) : phone === "ios-browser" ? (
          <ol className="push-steps">
            <li>
              On iPhone, notifications only work from the app on your home screen. In Safari, tap the{" "}
              <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.
            </li>
            <li>Open the app from your home screen and sign in.</li>
            <li>Come back to this page there and turn notifications on.</li>
          </ol>
        ) : phone === "unsupported" ? (
          <p className="card-sub warn">
            This browser can&apos;t get notifications. On iPhone, add the app to your home screen from Safari (needs iOS
            16.4 or later). On Android, use Chrome.
          </p>
        ) : phone === "blocked" ? (
          <p className="card-sub warn">
            Notifications are blocked for this app. On iPhone: Settings, Notifications, find this app and turn on Allow
            Notifications. On Android: press and hold the app icon, tap App info, then Notifications. Then reopen the app.
          </p>
        ) : phone === "on" ? (
          <div className="push-actions">
            <span className="mgr-pill on">On for this phone</span>
            <button type="button" className="btn" onClick={test} disabled={busy !== null}>
              {busy === "test" ? "Sending…" : "Send a test"}
            </button>
            <button type="button" className="link-button" onClick={disable} disabled={busy !== null}>
              Turn off on this phone
            </button>
          </div>
        ) : (
          <div className="push-actions">
            <button type="button" className="btn" onClick={enable} disabled={busy !== null}>
              {busy === "enable" ? "Turning on…" : "Turn on notifications"}
            </button>
            <span className="card-sub" style={{ margin: 0 }}>
              Your phone will ask to allow notifications. Choose Allow.
            </span>
          </div>
        )}
      </div>

      <div className="mgr-card">
        <h2>What to notify me about</h2>
        <p className="card-sub">
          Your choices, for all your devices. Only alerts for the locations your account covers are sent. Changes save
          as you make them.
        </p>
        {events.length === 0 ? (
          <p className="cust-empty">Your account doesn&apos;t have access to any alerts.</p>
        ) : (
          <ul className="push-events">
            {events.map((e) => (
              <li key={e}>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={prefs[e]}
                    disabled={busy === e}
                    onChange={(ev) => toggle(e, ev.target.checked)}
                  />
                  <span>
                    <strong>{PUSH_EVENT_INFO[e].label}</strong>
                    <span className="push-hint">{PUSH_EVENT_INFO[e].hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mgr-card">
        <h2>Your devices</h2>
        <p className="card-sub">
          Every phone you&apos;ve turned notifications on for. If one hasn&apos;t opened the app for two weeks it gets a
          reminder to, and if one stops receiving you&apos;ll get a text.
        </p>
        {devices.length === 0 ? (
          <p className="cust-empty">No devices yet.</p>
        ) : (
          <DeviceTable devices={devices} thisDeviceId={thisDeviceId} onRemove={remove} busy={busy} />
        )}
      </div>
    </>
  );
}

export function DeviceTable({
  devices,
  thisDeviceId,
  onRemove,
  busy,
}: {
  devices: DeviceSummary[];
  thisDeviceId?: string | null;
  onRemove: (d: DeviceSummary) => void;
  busy: string | null;
}) {
  return (
    <div className="mgr-table-wrap">
      <table className="mgr-table">
        <thead>
          <tr>
            <th>Device</th>
            <th>Last opened</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id}>
              <td>
                {d.device}
                {d.id === thisDeviceId && <span className="sub"> (this phone)</span>}
              </td>
              <td>{formatTimestamp(d.lastSeenAt)}</td>
              <td>
                {d.stoppedAt ? (
                  <span className="mgr-pill">Stopped {formatTimestamp(d.stoppedAt)}</span>
                ) : (
                  <span className="mgr-pill on">Working</span>
                )}
              </td>
              <td>
                <button
                  type="button"
                  className="link-button danger"
                  onClick={() => onRemove(d)}
                  disabled={busy !== null}
                >
                  {busy === `remove-${d.id}` ? "Removing…" : "Remove"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
