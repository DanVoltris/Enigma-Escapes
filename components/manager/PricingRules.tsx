"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/format";
import type { PricingMode } from "@/lib/pricing";

// Settings → Taxes & fees: whether the listed price includes tax, and what a
// deposit costs. Shows a live worked example so the effect is unambiguous.
export default function PricingRules({ initial, taxPercent }: { initial: PricingMode; taxPercent: number }) {
  const router = useRouter();
  const [taxInclusive, setTaxInclusive] = useState(initial.taxInclusive);
  const [flatDeposit, setFlatDeposit] = useState(
    initial.depositFlatCents != null ? (initial.depositFlatCents / 100).toString() : ""
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Worked example on a $30 listed price, 3 guests.
  const listed = 9000;
  const total = taxInclusive ? listed : listed + Math.round((listed * taxPercent) / 100);
  const sub = taxInclusive ? Math.round(total / (1 + taxPercent / 100)) : listed;
  const tax = total - sub;

  async function save() {
    setBusy(true);
    setError(null);
    const dollars = flatDeposit.trim();
    const cents = dollars === "" ? null : Math.round(Number(dollars) * 100);
    if (cents != null && (!Number.isFinite(cents) || cents <= 0)) {
      setError("Enter a deposit amount greater than zero, or leave it blank to use percentages.");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/manager/settings/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxInclusive, depositFlatCents: cents }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save. Try again.");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mgr-card">
      <h2>Pricing rules</h2>
      <p className="card-sub">How the price on the booking site relates to tax, and what a deposit costs.</p>

      <div className="mgr-form">
        <label className="intg-toggle">
          <input
            type="checkbox"
            checked={taxInclusive}
            onChange={(e) => {
              setTaxInclusive(e.target.checked);
              setSaved(false);
            }}
          />
          Listed prices include tax
        </label>
        <p className="field-hint" style={{ marginTop: -6 }}>
          {taxInclusive
            ? "A $30 room costs the customer exactly $30 — the tax is shown as a breakdown, not added on."
            : "A $30 room becomes $31.50 at checkout once tax is added."}
        </p>

        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="flat-deposit">Flat deposit (optional)</label>
          <input
            id="flat-deposit"
            type="number"
            min="0"
            step="1"
            placeholder="e.g. 30"
            value={flatDeposit}
            onChange={(e) => {
              setFlatDeposit(e.target.value);
              setSaved(false);
            }}
          />
          <p className="field-hint">
            One flat deposit per booking, whatever the group size. Leave blank to use each room&apos;s deposit
            percentage instead. A booking smaller than the deposit just pays its total.
          </p>
        </div>

        <div className="mgr-example">
          <strong>Example — 3 guests at $30:</strong> subtotal {formatMoney(sub)} + tax {formatMoney(tax)} ={" "}
          <strong>{formatMoney(total)}</strong>
          {flatDeposit.trim() !== "" && Number(flatDeposit) > 0 && (
            <>
              , deposit <strong>{formatMoney(Math.min(Math.round(Number(flatDeposit) * 100), total))}</strong> now
            </>
          )}
          .
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="button" className="btn" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save pricing rules"}
          </button>
          {saved && <span className="mgr-pill on">Saved</span>}
          {error && <span className="field-error">{error}</span>}
        </div>
      </div>
    </div>
  );
}
