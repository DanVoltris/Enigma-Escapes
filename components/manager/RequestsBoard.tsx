"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatDateLong, formatTime } from "@/lib/format";
import type { BookingRequest } from "@/lib/requests";

const STATUS_LABEL: Record<string, string> = {
  accepted: "Accepted — awaiting payment",
  declined: "Declined",
  completed: "Completed (booked & paid)",
  expired: "Expired",
};

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

      <div className="mgr-card">
        <h2>Pending{pending.length > 0 ? ` (${pending.length})` : ""}</h2>
        {pending.length === 0 ? (
          <p className="mgr-empty">No requests waiting — new ones appear here the moment a customer asks.</p>
        ) : (
          <ul className="mgr-notes">
            {pending.map((r) => (
              <li key={r.id}>
                <div>
                  <div>
                    <strong>
                      {r.roomName} — {formatTime(r.time)}
                    </strong>{" "}
                    ({formatDateLong(r.date)}, {r.location})
                  </div>
                  <div>
                    {r.firstName} {r.lastName} · {r.quantity} guest{r.quantity === 1 ? "" : "s"} ·{" "}
                    <a href={`tel:${r.phone}`}>{r.phone}</a>
                    {remaining[r.id] != null && (
                      <span className="sub"> · {remaining[r.id]} spot(s) currently free</span>
                    )}
                  </div>
                  <div className="when" suppressHydrationWarning>
                    Requested {new Date(r.createdAt).toLocaleTimeString("en-CA", { timeStyle: "short" })}
                  </div>
                </div>
                <span style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
                  <button type="button" className="btn" onClick={() => decide(r, "accept")} disabled={busyId === r.id}>
                    {busyId === r.id ? "Working…" : "Accept"}
                  </button>
                  <button
                    type="button"
                    className="link-button danger"
                    onClick={() => setDeclining(r)}
                    disabled={busyId === r.id}
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

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
                  <div className="sub">{STATUS_LABEL[r.status] ?? r.status}</div>
                </div>
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
