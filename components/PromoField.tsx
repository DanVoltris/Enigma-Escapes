"use client";

import { useState } from "react";
import { useCart } from "@/lib/cart";

// Promo code entry. Validated against the server before it's applied, so the
// discount shown always matches what create-booking will recompute.
export default function PromoField() {
  const { promo, setPromo } = useCart();
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
      setPromo({ code: data.code, percentOff: data.percentOff });
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check that code. Try again.");
    } finally {
      setChecking(false);
    }
  }

  if (promo) {
    return (
      <div className="promo-applied">
        <span>
          <strong>{promo.code}</strong> applied — {promo.percentOff}% off
        </span>
        <button type="button" className="link-button" onClick={() => setPromo(null)}>
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="field">
      <label htmlFor="promo-code">Promo code</label>
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
