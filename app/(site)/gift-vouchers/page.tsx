"use client";

import { useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { DENOMINATIONS_CENTS, MAX_CUSTOM_CENTS, MIN_CUSTOM_CENTS } from "@/lib/voucher-shop-config";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MAX = 200;

// Card input masks — the separators the card itself prints.
function formatCardNumber(v: string): string {
  return v.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim();
}
function formatExpiry(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
}
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

type Errors = Partial<Record<"amount" | "buyerName" | "buyerEmail" | "recipientEmail" | "card", string>>;

export default function GiftVouchersPage() {
  const [amountCents, setAmountCents] = useState<number>(DENOMINATIONS_CENTS[0]);
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [message, setMessage] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");

  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");

  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; amountCents: number } | null>(null);

  const chosenCents = useCustom ? Math.round(Number(customAmount) * 100) : amountCents;

  async function buy(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const next: Errors = {};

    if (!Number.isFinite(chosenCents) || chosenCents < MIN_CUSTOM_CENTS || chosenCents > MAX_CUSTOM_CENTS) {
      next.amount = `Choose an amount between ${formatMoney(MIN_CUSTOM_CENTS)} and ${formatMoney(MAX_CUSTOM_CENTS)}.`;
    }
    if (!buyerName.trim()) next.buyerName = "Enter your name.";
    if (!EMAIL_RE.test(buyerEmail.trim())) next.buyerEmail = "Enter a valid email address.";
    if (recipientEmail.trim() && !EMAIL_RE.test(recipientEmail.trim())) {
      next.recipientEmail = "That email doesn't look right.";
    }
    const digits = cardNumber.replace(/\s/g, "");
    const exp = expiry.trim().match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/);
    if (!cardName.trim() || !/^\d{13,19}$/.test(digits) || !luhnValid(digits) || !exp || !/^\d{3,4}$/.test(cvc)) {
      next.card = "Check the card details — name, a valid number, expiry as MM/YY and the security code.";
    } else if (new Date(2000 + Number(exp[2]), Number(exp[1]), 1) <= new Date()) {
      next.card = "This card has expired. Use a different card.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      // Card details are validated in the browser and never leave it — this is
      // the same simulated payment the booking flow uses until Stripe is live.
      const res = await fetch("/api/vouchers/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents: chosenCents,
          buyerName: buyerName.trim(),
          buyerEmail: buyerEmail.trim(),
          recipientEmail: recipientEmail.trim() || null,
          message: message.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
      setIssued({ code: data.code, amountCents: data.amountCents });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (issued) {
    return (
      <div className="gv-done">
        <h1 className="page-title">Gift voucher ready</h1>
        <p>
          Here&apos;s the code — keep it somewhere safe and pass it on to whoever it&apos;s for. We&apos;ve got a copy
          on file, so we can look it up if it goes missing.
        </p>
        <div className="gv-code">{issued.code}</div>
        <p className="gv-worth">Worth {formatMoney(issued.amountCents)} towards any escape room.</p>
        <p className="gv-note">
          It can be spent across more than one visit — whatever&apos;s left stays on the code until it&apos;s used up.
        </p>
        <Link href="/" className="btn">
          Back to booking
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">Gift vouchers</h1>
      <p className="page-sub">
        Give an escape room. Vouchers work on any of our experiences at any location, never expire, and can be spent
        over more than one visit.
      </p>

      <div className="checkout-grid">
        <form className="form-card" onSubmit={buy} noValidate>
          <h3>Choose an amount</h3>
          <div className="gv-amounts">
            {DENOMINATIONS_CENTS.map((c) => (
              <button
                key={c}
                type="button"
                className={`gv-amount${!useCustom && amountCents === c ? " on" : ""}`}
                onClick={() => {
                  setUseCustom(false);
                  setAmountCents(c);
                  setErrors((e) => ({ ...e, amount: undefined }));
                }}
              >
                {formatMoney(c)}
              </button>
            ))}
            <button
              type="button"
              className={`gv-amount${useCustom ? " on" : ""}`}
              onClick={() => setUseCustom(true)}
            >
              Other
            </button>
          </div>
          {useCustom && (
            <div className={`field ${errors.amount ? "invalid" : ""}`} style={{ maxWidth: 200 }}>
              <label htmlFor="custom">Amount ($)</label>
              <input
                id="custom"
                type="number"
                min={MIN_CUSTOM_CENTS / 100}
                max={MAX_CUSTOM_CENTS / 100}
                step="1"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
              />
            </div>
          )}
          {errors.amount && <p className="field-error">{errors.amount}</p>}

          <h3>Who it&apos;s for</h3>
          <div className={`field ${errors.recipientEmail ? "invalid" : ""}`}>
            <label htmlFor="rec">Their email (optional)</label>
            <input
              id="rec"
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="So we know who it was meant for"
            />
            {errors.recipientEmail && <p className="field-error">{errors.recipientEmail}</p>}
          </div>
          <div className="field">
            <label htmlFor="msg">Add a personalised message (optional)</label>
            <textarea
              id="msg"
              rows={3}
              maxLength={MESSAGE_MAX}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="field-hint">
              {MESSAGE_MAX - message.length} characters remaining
            </p>
          </div>

          <h3>Your details</h3>
          <div className={`field ${errors.buyerName ? "invalid" : ""}`}>
            <label htmlFor="bn">
              Your name <span className="req">*</span>
            </label>
            <input id="bn" type="text" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} autoComplete="name" />
            {errors.buyerName && <p className="field-error">{errors.buyerName}</p>}
          </div>
          <div className={`field ${errors.buyerEmail ? "invalid" : ""}`}>
            <label htmlFor="be">
              Your email <span className="req">*</span>
            </label>
            <input
              id="be"
              type="email"
              value={buyerEmail}
              onChange={(e) => setBuyerEmail(e.target.value)}
              autoComplete="email"
            />
            {errors.buyerEmail && <p className="field-error">{errors.buyerEmail}</p>}
          </div>

          <h3>Payment</h3>
          <div className={`field ${errors.card ? "invalid" : ""}`}>
            <label htmlFor="cn">Name on card</label>
            <input id="cn" type="text" value={cardName} onChange={(e) => setCardName(e.target.value)} autoComplete="cc-name" />
          </div>
          <div className="field">
            <label htmlFor="cnum">Card number</label>
            <input
              id="cnum"
              inputMode="numeric"
              value={cardNumber}
              onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
              autoComplete="cc-number"
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="exp">Expiry (MM/YY)</label>
              <input
                id="exp"
                inputMode="numeric"
                value={expiry}
                onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                autoComplete="cc-exp"
              />
            </div>
            <div className="field">
              <label htmlFor="cvc">Security code</label>
              <input
                id="cvc"
                inputMode="numeric"
                value={cvc}
                onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                autoComplete="cc-csc"
              />
            </div>
          </div>
          {errors.card && <p className="field-error">{errors.card}</p>}
          {serverError && <p className="error-banner">{serverError}</p>}

          <div className="form-actions">
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Working…" : `Buy voucher — ${formatMoney(Number.isFinite(chosenCents) ? chosenCents : 0)}`}
            </button>
          </div>
        </form>

        <aside className="summary-card">
          <h2>Gift voucher</h2>
          <div className="summary-line">
            <span>Voucher value</span>
            <span>{formatMoney(Number.isFinite(chosenCents) ? chosenCents : 0)}</span>
          </div>
          <div className="summary-total">
            <span>Total</span>
            <span>{formatMoney(Number.isFinite(chosenCents) ? chosenCents : 0)}</span>
          </div>
          <p className="field-hint" style={{ marginTop: 12 }}>
            No tax is charged on the voucher itself — tax applies when it&apos;s spent on a room.
          </p>
        </aside>
      </div>
    </>
  );
}
