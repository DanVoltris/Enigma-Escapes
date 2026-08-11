"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Create a giveaway / apology / prize code. Leave the code box empty and one
// is generated; type your own to keep a scheme the team already uses.
export default function NewStaffCode() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("30");
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    setMade(null);
    try {
      const res = await fetch("/api/manager/vouchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount),
          code: code.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not create that code.");
      setMade((data as { code: string }).code);
      setCode("");
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that code.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="vch-save">
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          + New code
        </button>
        {made && (
          <span className="mgr-pill on">
            Created <strong>{made}</strong>
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mgr-card">
      <h2>New staff code</h2>
      <p className="card-sub">
        A dollar balance to hand out — a giveaway, an apology, an event prize. It redeems like a gift voucher and can
        be spent over more than one visit.
      </p>
      <div className="vch-row">
        <div className="field" style={{ maxWidth: 140 }}>
          <label htmlFor="nsc-amount">Amount ($)</label>
          <input
            id="nsc-amount"
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="nsc-code">Code (optional)</label>
          <input
            id="nsc-code"
            type="text"
            value={code}
            placeholder="Leave blank to generate"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <p className="field-hint">Letters, numbers and hyphens — no spaces.</p>
        </div>
        <div className="field" style={{ flex: "1 1 240px" }}>
          <label htmlFor="nsc-note">What it&apos;s for (optional)</label>
          <input
            id="nsc-note"
            type="text"
            value={note}
            placeholder="e.g. Chamber of Commerce raffle"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={create} disabled={busy || amount.trim() === ""}>
          {busy ? "Creating…" : "Create code"}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
          Done
        </button>
        {made && (
          <span className="mgr-pill on">
            Created <strong>{made}</strong>
          </span>
        )}
        {error && <span className="field-error">{error}</span>}
      </div>
    </div>
  );
}
