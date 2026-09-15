"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { currentSubscription, flagOn, pushSupported, reconnect, reportSeen, setFlag, turnOn } from "@/lib/push-client";

// Runs on every portal load. On a phone that has notifications on it keeps
// "last opened" current (what the two-week reminder measures) and, if the
// phone's notifications have been lost, reconnects them on the spot — or, where
// the phone won't allow that without a tap, says so with a button.
export default function PushBanner({ publicKey }: { publicKey: string | null }) {
  const [problem, setProblem] = useState<"lost" | "blocked" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey || !pushSupported()) return;
    let cancelled = false;
    (async () => {
      const sub = await currentSubscription().catch(() => null);
      let lost = false;
      if (sub) {
        const seen = await reportSeen(sub).catch(() => null);
        if (seen?.status === "stopped") lost = true;
        // Removed on purpose, from another device or the Team page: respect it.
        if (seen?.status === "unknown") {
          await sub.unsubscribe().catch(() => false);
          setFlag(false);
        }
      } else if (flagOn()) {
        lost = true; // turned on here before, and the phone no longer has it
      }
      if (!lost || cancelled) return;
      if (Notification.permission === "denied") {
        setProblem("blocked");
        return;
      }
      try {
        await reconnect(publicKey);
      } catch {
        if (!cancelled) setProblem("lost");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  if (!problem) return null;

  return (
    <div className="push-banner" role="status">
      {problem === "blocked" ? (
        <span>
          Notifications have been blocked on this phone, so you won&apos;t get alerts here.{" "}
          <Link href="/manager/notifications">How to turn them back on</Link>
        </span>
      ) : (
        <>
          <span>Notifications stopped on this phone. Turn them back on so alerts keep coming.</span>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await turnOn(publicKey!);
                setProblem(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : "That didn't work. Please try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Turning on…" : "Turn back on"}
          </button>
          {error && <span className="push-banner-error">{error}</span>}
        </>
      )}
    </div>
  );
}
