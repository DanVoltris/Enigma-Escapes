"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Progress = { total: number; sent: number; failed: number; pending: number };

// Watches a campaign send, and drives it: each call texts the next few numbers
// and comes back, because the hosting cuts a request off after a minute and a
// plain phone number only manages about one text a second. Leave the page open
// and it keeps going; close it and the campaign stops where it is, to be
// picked up again from here.
export default function CampaignRun({
  id,
  status: initialStatus,
  initialProgress,
  message,
}: {
  id: string;
  status: "draft" | "sending" | "paused" | "done";
  initialProgress: Progress;
  message: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [progress, setProgress] = useState(initialProgress);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const sendBatch = useCallback(async () => {
    const res = await fetch(`/api/manager/campaigns/${id}/send`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as Partial<Progress> & {
      error?: string;
      status?: typeof status;
      done?: boolean;
    };
    if (!res.ok) throw new Error(data.error ?? "That batch didn't send.");
    if (typeof data.total === "number") {
      setProgress({
        total: data.total,
        sent: data.sent ?? 0,
        failed: data.failed ?? 0,
        pending: data.pending ?? 0,
      });
    }
    if (data.status) setStatus(data.status);
    return data.status === "sending" && (data.pending ?? 0) > 0;
  }, [id]);

  // The loop. Only one at a time, and it stops the moment the campaign is
  // paused, finishes, or a batch fails — a failure that repeats would otherwise
  // hammer Twilio.
  useEffect(() => {
    if (status !== "sending" || running.current) return;
    running.current = true;
    let cancelled = false;
    (async () => {
      try {
        while (!cancelled) {
          const more = await sendBatch();
          if (!more) break;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sending stopped.");
      } finally {
        running.current = false;
        if (!cancelled) router.refresh();
      }
    })();
    return () => {
      cancelled = true;
      running.current = false;
    };
  }, [status, sendBatch, router]);

  async function setRunState(next: "sending" | "paused") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/campaigns/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; progress?: Progress };
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");
      if (data.progress) setProgress(data.progress);
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const done = progress.total - progress.pending;
  const percent = progress.total === 0 ? 0 : Math.round((done / progress.total) * 100);

  return (
    <div className="mgr-card">
      {error && <div className="error-banner">{error}</div>}

      <div className="campaign-preview">
        <span className="label">What each customer receives</span>
        <p>{message}</p>
      </div>

      <div className="campaign-bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="card-sub">
        <strong>{progress.sent.toLocaleString()}</strong> sent
        {progress.failed > 0 && <> · {progress.failed.toLocaleString()} couldn&apos;t be delivered</>} ·{" "}
        {progress.pending.toLocaleString()} to go ({percent}%)
      </p>

      {status === "sending" && (
        <p className="card-sub">
          Sending now — keep this page open. About one text a second, so{" "}
          {Math.max(1, Math.ceil(progress.pending / 60))} minute(s) left.
        </p>
      )}
      {status === "paused" && <p className="card-sub">Paused. Nobody else is being texted.</p>}
      {status === "done" && <p className="card-sub">Finished.</p>}

      <div className="push-actions">
        {status === "sending" ? (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setRunState("paused")}>
            Pause
          </button>
        ) : status === "done" ? null : (
          <button type="button" className="btn" disabled={busy} onClick={() => setRunState("sending")}>
            {progress.sent > 0 ? "Carry on sending" : "Start sending"}
          </button>
        )}
      </div>
    </div>
  );
}
