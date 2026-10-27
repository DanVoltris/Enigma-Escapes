"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/format";

// "Charge a card" on a booking's Payments tab: a customer reads their card out
// over the phone and staff type it into Stripe's card box. The box is Stripe's
// own iframe, so the number goes straight to Stripe — this page only ever gets
// back a PaymentMethod id, which is all the server sees (lib/card-entry.ts).

type StripeCardElement = {
  mount: (el: HTMLElement) => void;
  destroy: () => void;
  clear: () => void;
  on: (event: "change", cb: (e: { complete: boolean; error?: { message: string } }) => void) => void;
};
type StripeJs = {
  elements: () => { create: (type: "card", opts?: Record<string, unknown>) => StripeCardElement };
  createPaymentMethod: (o: {
    type: "card";
    card: StripeCardElement;
  }) => Promise<{ paymentMethod?: { id: string }; error?: { message?: string } }>;
};
type StripeFactory = (key: string) => StripeJs;

// Stripe.js has to load from Stripe itself (never bundled or self-hosted) — that
// is part of what keeps the card number off our pages. Loaded once, on demand.
let stripeJs: Promise<StripeFactory> | null = null;
function loadStripe(): Promise<StripeFactory> {
  const w = window as unknown as { Stripe?: StripeFactory };
  if (w.Stripe) return Promise.resolve(w.Stripe);
  stripeJs ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.async = true;
    s.onload = () => (w.Stripe ? resolve(w.Stripe) : reject(new Error("Stripe didn't load.")));
    s.onerror = () => {
      stripeJs = null;
      reject(new Error("Couldn't load Stripe. Check the internet connection and reload."));
    };
    document.head.appendChild(s);
  });
  return stripeJs;
}

function newAttemptKey(): string {
  return crypto.randomUUID();
}

export default function CardCharge({
  bookingId,
  balanceCents,
  publishableKey,
}: {
  bookingId: string;
  balanceCents: number;
  publishableKey: string;
}) {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeJs | null>(null);
  const cardRef = useRef<StripeCardElement | null>(null);
  const [ready, setReady] = useState(false);
  const [complete, setComplete] = useState(false);
  const [amount, setAmount] = useState((balanceCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // One key per attempt: pressing Charge again after a timeout re-sends the
  // same key, and Stripe answers with the first result instead of charging
  // twice. A fresh key only once Stripe has actually said no.
  const attemptKey = useRef(newAttemptKey());

  // A payment taken refreshes the page with a smaller balance; refill the box.
  const [filledFor, setFilledFor] = useState(balanceCents);
  if (filledFor !== balanceCents) {
    setFilledFor(balanceCents);
    setAmount((balanceCents / 100).toFixed(2));
  }

  useEffect(() => {
    let card: StripeCardElement | null = null;
    let gone = false;
    loadStripe()
      .then((factory) => {
        if (gone || !mountRef.current) return;
        const stripe = factory(publishableKey);
        card = stripe.elements().create("card", {
          // Stripe's iframe can't see our self-hosted font, so the system one.
          style: { base: { fontSize: "15px", fontFamily: "system-ui, sans-serif", color: "#1a1a1a" } },
        });
        card.mount(mountRef.current);
        card.on("change", (e) => {
          setComplete(e.complete);
          setError(e.error?.message ?? null);
        });
        stripeRef.current = stripe;
        cardRef.current = card;
        setReady(true);
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      gone = true;
      card?.destroy();
      cardRef.current = null;
    };
  }, [publishableKey]);

  function changeAmount(value: string) {
    const cents = Math.round(Number(value) * 100);
    setAmount(Number.isFinite(cents) && cents > balanceCents ? (balanceCents / 100).toFixed(2) : value);
  }

  async function charge() {
    const stripe = stripeRef.current;
    const card = cardRef.current;
    if (!stripe || !card) return;
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) return setError("Enter an amount greater than zero.");
    if (amountCents > balanceCents) return setError(`That's more than the ${formatMoney(balanceCents)} still due.`);
    if (!complete) return setError("Fill in the card number, expiry, CVC and postal code.");
    if (!confirm(`Charge ${formatMoney(amountCents)} to this card now?`)) return;

    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const pm = await stripe.createPaymentMethod({ type: "card", card });
      if (!pm.paymentMethod) {
        setError(pm.error?.message ?? "Those card details weren't accepted.");
        return;
      }
      const res = await fetch(`/api/manager/bookings/${bookingId}/card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethodId: pm.paymentMethod.id,
          amountCents,
          idempotencyKey: attemptKey.current,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; final?: boolean; card?: string | null };
      if (!res.ok) {
        if (data.final) attemptKey.current = newAttemptKey();
        setError(data.error ?? "The card was not charged.");
        return;
      }
      attemptKey.current = newAttemptKey();
      card.clear();
      setComplete(false);
      setDone(`${formatMoney(amountCents)} charged${data.card ? ` to ${data.card}` : ""}.`);
      router.refresh();
    } catch {
      // Never heard back — keep the key, so pressing Charge again can't double up.
      setError("Couldn't reach the server. Press Charge again — the card won't be charged twice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bk-add">
      <h3>Charge a card</h3>
      <p className="card-sub">
        For a customer paying over the phone. The card is charged straight away through Stripe, and the number goes
        to Stripe only, never into this system. Don&apos;t write card numbers down anywhere else.
      </p>
      <div className="field" style={{ maxWidth: 520 }}>
        <label>Card</label>
        <div ref={mountRef} className="card-entry-box" aria-busy={!ready} />
      </div>
      <div className="mgr-inline-form" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="bk-card-amount">Amount ($)</label>
          <input
            id="bk-card-amount"
            type="number"
            min="0.01"
            max={(balanceCents / 100).toFixed(2)}
            step="0.01"
            value={amount}
            onChange={(e) => changeAmount(e.target.value)}
            style={{ width: 110 }}
          />
        </div>
        <button type="button" className="btn" onClick={charge} disabled={busy || !ready}>
          {busy ? "Charging…" : "Charge card"}
        </button>
      </div>
      {error && <p className="field-error" style={{ marginTop: 10 }}>{error}</p>}
      {done && <p className="mgr-success" style={{ marginTop: 10 }}>{done}</p>}
    </div>
  );
}
