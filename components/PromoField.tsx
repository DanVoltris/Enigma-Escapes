"use client";

import { useState } from "react";
import { useCart } from "@/lib/cart";
import { formatMoney } from "@/lib/format";

// Code entry for promo codes and gift vouchers alike — one box, because a
// customer holding a code shouldn't have to know which kind it is. Validated
// against the server before it's applied, so what's shown always matches what
// create-booking will recompute.
export default function PromoField() {
  const { promo, voucher, setPromo, setVoucher } = useCart();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    const clean = code.trim().toUpperCase();
    if (!clean || checking) return;
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/promo?code=${encodeURIComponent(clean)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not check that code. Try again.");
      if (data.kind === "voucher") {
        setVoucher({ code: data.code, remainingCents: data.remainingCents });
      } else {
        setPromo({ code: data.code, percentOff: data.percentOff });
      }
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check that code. Try again.");
    } finally {
      setChecking(false);
    }
  }

  const applied = (
    <>
        {promo && (
          <div className="promo-applied">
            <span>
              <strong>{promo.code}</strong> applied — {promo.percentOff}% off
            </span>
            <button type="button" className="link-button" onClick={() => setPromo(null)}>
              Remove
            </button>
          </div>
        )}
        {voucher && (
          <div className="promo-applied">
            <span>
              <strong>{voucher.code}</strong> applied — {formatMoney(voucher.remainingCents)} gift voucher
            </span>
            <button type="button" className="link-button" onClick={() => setVoucher(null)}>
              Remove
            </button>
          </div>
      )}
    </>
  );

  // Both slots filled — nothing left to enter.
  if (promo && voucher) return <div className="field">{applied}</div>;

  return (
    <div className="field">
      {applied}
      <label htmlFor="promo-code">{promo ? "Gift voucher code" : voucher ? "Promo code" : "Promo or gift voucher code"}</label>
      <div className="promo-entry">
        <input
          id="promo-code"
          type="text"
          value={code}
          placeholder="Enter a code"
          autoComplete="off"
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          // Enter applies the code instead of submitting the whole form.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
        />
        <button type="button" className="btn btn-outline" onClick={apply} disabled={checking || code.trim() === ""}>
          {checking ? "Checking…" : "Apply"}
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
