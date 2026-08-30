"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, formatTimestamp } from "@/lib/format";

type Row = {
  id: string;
  methodLabel: string;
  amountCents: number;
  refundedCents: number;
  refundableCents: number;
  payer: string | null;
  at: string;
  toCard: boolean; // Stripe can send this one back to the card
  card: string | null; // "Visa •••• 4242" where Stripe knows it
};

type Loaded = {
  paidCents: number;
  refundedCents: number;
  refundOwedCents: number;
  payments: Row[];
};

const when = (iso: string) =>
  formatTimestamp(iso);

// Refund part or all of a payment, without cancelling the booking. Each payment
// is refunded separately, because a party often pays on several cards and the
// money has to go back to the one that was charged.
export default function RefundPanel({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    setOpen(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/manager/bookings/${bookingId}/refunds`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not load the payments.");
        return;
      }
      setData(d);
      // Default each box to everything still refundable on that payment.
      setAmounts(
        Object.fromEntries(
          (d.payments as Row[]).map((p) => [p.id, (p.refundableCents / 100).toFixed(2)])
        )
      );
    } catch {
      setError("Could not load the payments. Check your connection and try again.");
    }
  }

  async function refund(row: Row) {
    const cents = Math.round(parseFloat(amounts[row.id] || "0") * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("Enter how much to refund.");
      return;
    }
    if (cents > row.refundableCents) {
      setError(`That payment only has ${formatMoney(row.refundableCents)} left to refund.`);
      return;
    }
    setBusy(row.id);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/manager/bookings/${bookingId}/refunds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: row.id, amountCents: cents }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not issue the refund.");
        return;
      }
      setDone(
        d.toCard
          ? `${formatMoney(d.refundedCents)} sent back to the card.`
          : `${formatMoney(d.refundedCents)} recorded — refund it on the machine that took the payment.`
      );
      await load();
      router.refresh();
    } catch {
      setError("Could not issue the refund. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-outline" onClick={load}>
        Refund a payment
      </button>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      {done && <p className="mgr-pill on">{done}</p>}
      {error && <p className="field-error">{error}</p>}

      {!data ? (
        <p className="sub">Loading payments…</p>
      ) : data.payments.length === 0 ? (
        <p className="cust-empty">
          No payments have been recorded on this booking, so there is nothing to refund.
        </p>
      ) : (
        <>
          {data.refundOwedCents > 0 && (
            <p className="sub" style={{ color: "var(--danger)" }}>
              {formatMoney(data.refundOwedCents)} is owed back on this booking.
            </p>
          )}
          <ul className="cust-activity">
            {data.payments.map((p) => (
              <li key={p.id}>
                <div className="body" style={{ width: "100%" }}>
                  <div>
                    <strong>{formatMoney(p.amountCents)}</strong> · {p.card ?? p.methodLabel}
                    {p.payer ? ` · ${p.payer}` : ""}
                  </div>
                  <div className="when">
                    {when(p.at)}
                    {p.refundedCents > 0 && ` · ${formatMoney(p.refundedCents)} already refunded`}
                    {!p.toCard && " · taken outside this system"}
                  </div>

                  {p.refundableCents <= 0 ? (
                    <p className="sub">Fully refunded.</p>
                  ) : (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                      <span className="sub">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={(p.refundableCents / 100).toFixed(2)}
                        value={amounts[p.id] ?? ""}
                        onChange={(e) => setAmounts({ ...amounts, [p.id]: e.target.value })}
                        style={{ maxWidth: 120 }}
                        aria-label={`Amount to refund from the ${formatMoney(p.amountCents)} payment`}
                      />
                      <button
                        type="button"
                        className="btn"
                        disabled={busy !== null}
                        onClick={() => refund(p)}
                      >
                        {busy === p.id ? "Refunding…" : p.toCard ? "Refund to card" : "Record refund"}
                      </button>
                      <span className="sub">of {formatMoney(p.refundableCents)}</span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="sub">
            A refund here does not cancel the booking or change what the session cost — it records money
            going back. Payments taken on a machine this app isn&apos;t paired with have to be refunded there;
            recording it keeps the booking honest.
          </p>
        </>
      )}

      <div className="vch-save" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
}
