"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatDateLong, formatTime, minutesUntilSlot } from "@/lib/format";
import type { BookingRequest } from "@/lib/requests";

const STATUS_LABEL: Record<string, string> = {
  accepted: "Accepted — awaiting payment",
  declined: "Declined",
  completed: "Booked & paid",
  expired: "Expired",
};

function countdown(date: string, time: string): { label: string; urgent: boolean } {
  const mins = minutesUntilSlot(date, time);
  if (mins <= 0) return { label: "started", urgent: true };
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return { label: `starts in ${h > 0 ? `${h}h ` : ""}${m}m`, urgent: mins <= 45 };
}

export default function RequestsBoard({
  initialRequests,
  remaining,
}: {
  initialRequests: BookingRequest[];
  remaining: Record<string, number | null>;
}) {
  const router = useRouter();
  const [requests, setRequests] = useState(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<BookingRequest | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(r: BookingRequest, action: "accept" | "decline") {
    setBusyId(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/manager/requests/${r.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not update the request.");
      setRequests((rs) =>
        rs.map((x) => (x.id === r.id ? { ...x, status: action === "accept" ? "accepted" : "declined" } : x))
      );
      const url = (data as { completionUrl?: string | null }).completionUrl;
      if (url) setLinks((l) => ({ ...l, [r.id]: url }));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the request.");
    } finally {
      setBusyId(null);
      setDeclining(null);
    }
  }

  async function copy(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy the link:", url); // clipboard unavailable — show it
    }
  }

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending").slice(0, 20);

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      {pending.length === 0 ? (
        <p className="mgr-empty">No requests waiting — new ones appear here the moment a customer asks.</p>
      ) : (
        <div className="req-grid">
          {pending.map((r) => {
            const cd = countdown(r.date, r.time);
            return (
              <div className="req-card" key={r.id}>
                <div className="req-top">
                  <div className="req-time">
                    <span className="big">{formatTime(r.time)}</span>
                    <span className={`req-countdown${cd.urgent ? " urgent" : ""}`}>{cd.label}</span>
                  </div>
                  <div className="req-what">
                    <div className="req-room">{r.roomName}</div>
                    <div className="req-where">
                      {r.location} · {formatDateLong(r.date)}
                    </div>
                  </div>
                </div>
                <div className="req-rows">
                  <div className="req-row">
                    <span className="req-label">Customer</span>
                    <span>
                      <strong>
                        {r.firstName} {r.lastName}
                      </strong>{" "}
                      · <a href={`tel:${r.phone}`}>{r.phone}</a>
                    </span>
                  </div>
                  <div className="req-row">
                    <span className="req-label">Group</span>
                    <span>
                      {r.quantity} guest{r.quantity === 1 ? "" : "s"}
                      {remaining[r.id] != null && (
                        <span className="sub"> — {remaining[r.id]} spot(s) currently free</span>
                      )}
                    </span>
                  </div>
                  <div className="req-row">
                    <span className="req-label">Requested</span>
                    <span suppressHydrationWarning>
                      {new Date(r.createdAt).toLocaleTimeString("en-CA", { timeStyle: "short" })}
                    </span>
                  </div>
                </div>
                <div className="req-actions">
                  <button type="button" className="btn" onClick={() => decide(r, "accept")} disabled={busyId === r.id}>
                    {busyId === r.id ? "Working…" : "Accept request"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline req-decline"
                    onClick={() => setDeclining(r)}
                    disabled={busyId === r.id}
                  >
                    Decline
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {Object.keys(links).length > 0 && (
        <div className="mgr-card">
          <h2>Send the customer their payment link</h2>
          <p className="card-sub">
            Accepted just now — if texting is configured this was already sent automatically; otherwise copy it and
            text/say it to the customer.
          </p>
          <ul className="mgr-notes">
            {Object.entries(links).map(([id, url]) => {
              const r = requests.find((x) => x.id === id);
              return (
                <li key={id}>
                  <div>
                    <div>
                      <strong>{r ? `${r.firstName} ${r.lastName}` : "Customer"}</strong> —{" "}
                      <code className="key-code">{url}</code>
                    </div>
                  </div>
                  <button type="button" className="link-button" onClick={() => copy(id, url)}>
                    {copied === id ? "Copied ✓" : "Copy link"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {decided.length > 0 && (
        <div className="mgr-card">
          <h2>Recent decisions</h2>
          <ul className="mgr-notes">
            {decided.map((r) => (
              <li key={r.id}>
                <div>
                  <div>
                    <strong>
                      {r.roomName} — {formatTime(r.time)}
                    </strong>{" "}
                    · {r.firstName} {r.lastName} · {r.quantity} guest{r.quantity === 1 ? "" : "s"}
                  </div>
                </div>
                <span className={`mgr-pill${r.status === "completed" ? " on" : ""}`} style={{ flexShrink: 0 }}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={declining !== null}
        title="Decline this request?"
        confirmLabel="Yes, decline"
        busy={busyId === declining?.id}
        onConfirm={() => declining && decide(declining, "decline")}
        onCancel={() => busyId === null && setDeclining(null)}
      >
        <p>
          <strong>
            {declining?.firstName} {declining?.lastName}
          </strong>{" "}
          asked for <strong>{declining?.roomName}</strong> at {declining ? formatTime(declining.time) : ""} for{" "}
          {declining?.quantity} guest{(declining?.quantity ?? 0) === 1 ? "" : "s"}.
        </p>
        <p style={{ marginTop: 10 }}>They&apos;ll be texted that the time doesn&apos;t work (when texting is configured).</p>
      </ConfirmDialog>
    </>
  );
}
