"use client";

import { useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { voucherShortfallNote } from "@/lib/voucher-minimum";

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

// What the venue's own prices allow, worked out server-side and re-checked
// there when the purchase is made.
export type AmountRules = {
  minCents: number;
  maxCents: number;
  onePersonCents: number;
  smallestBookingCents: number;
  minChargedGuests: number;
};

// "45", "45.50", "$45" → cents. Anything else → null, which is what shows the
// error rather than quietly buying a voucher for a number nobody typed.
function parseAmount(raw: string): number | null {
  const t = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export default function GiftVoucherForm({
  stripeEnabled,
  rules,
  shopOpen,
}: {
  stripeEnabled: boolean;
  rules: AmountRules;
  // Switching every amount off on the Gift vouchers tab still closes the online
  // shop, as it always did — the amounts no longer decide what a buyer may
  // choose, but they do decide whether anything is for sale at all.
  shopOpen: boolean;
}) {
  // Typed, not picked from a list: any amount at or above the venue's minimum.
  const [amount, setAmount] = useState("");
  const amountCents = parseAmount(amount) ?? 0;
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


  // Said as they type, not after they pay: a voucher under the price of a game
  // is still a fine present, but the buyer should know it won't cover one.
  const shortfall =
    amountCents >= rules.minCents
      ? voucherShortfallNote(amountCents, rules.smallestBookingCents, rules.minChargedGuests)
      : null;

  async function buy(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const next: Errors = {};

    const typed = parseAmount(amount);
    if (typed === null) {
      next.amount = "Enter an amount in dollars, e.g. 50 or 45.50.";
    } else if (typed < rules.minCents) {
      next.amount = `The smallest gift voucher we sell is ${formatMoney(rules.minCents)}.`;
    } else if (typed > rules.maxCents) {
      next.amount = `${formatMoney(rules.maxCents)} is the most we can sell in one voucher — call us for anything larger.`;
    }
    if (!buyerName.trim()) next.buyerName = "Enter your name.";
    if (!EMAIL_RE.test(buyerEmail.trim())) next.buyerEmail = "Enter a valid email address.";
    if (recipientEmail.trim() && !EMAIL_RE.test(recipientEmail.trim())) {
      next.recipientEmail = "That email doesn't look right.";
    }
    // With Stripe live the card is collected on Stripe's own page, so there's
    // nothing to validate here.
    if (!stripeEnabled) {
      const digits = cardNumber.replace(/\s/g, "");
      const exp = expiry.trim().match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/);
      if (!cardName.trim() || !/^\d{13,19}$/.test(digits) || !luhnValid(digits) || !exp || !/^\d{3,4}$/.test(cvc)) {
        next.card = "Check the card details — name, a valid number, expiry as MM/YY and the security code.";
      } else if (new Date(2000 + Number(exp[2]), Number(exp[1]), 1) <= new Date()) {
        next.card = "This card has expired. Use a different card.";
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      // Without Stripe the card is validated in the browser and never leaves
      // it — the same simulated payment the booking flow uses.
      const res = await fetch("/api/vouchers/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents: amountCents,
          buyerName: buyerName.trim(),
          buyerEmail: buyerEmail.trim(),
          recipientEmail: recipientEmail.trim() || null,
          message: message.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
      // Stripe path: hand off to hosted checkout, which returns to /done.
      if (data.url) {
        window.location.assign(data.url as string);
        return;
      }
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

  if (!shopOpen) {
    return (
      <div className="empty-state">
        <h1 className="page-title">Gift vouchers</h1>
        <p>They&apos;re not on sale online just now — give us a call and we&apos;ll sort one out for you.</p>
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
          <h3>Buy a gift voucher</h3>
          <div className={`field ${errors.amount ? "invalid" : ""}`} style={{ maxWidth: 360 }}>
            <label htmlFor="gv-amount">
              How much is it for? <span className="req">*</span>
            </label>
            <div className="gv-amount">
              <span className="gv-amount-sign" aria-hidden="true">
                $
              </span>
              <input
                id="gv-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="50"
                value={amount}
                aria-describedby="gv-amount-hint"
                onChange={(e) => {
                  setAmount(e.target.value);
                  setErrors((er) => ({ ...er, amount: undefined }));
                }}
              />
            </div>
            <p className="field-hint" id="gv-amount-hint">
              Any amount from {formatMoney(rules.minCents)} to {formatMoney(rules.maxCents)}. Spend it on any
              experience, at any location, over as many visits as it takes.
            </p>
            {shortfall && <p className="field-hint gv-heads-up">{shortfall}</p>}
            {errors.amount && <p className="field-error">{errors.amount}</p>}
          </div>

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

          {stripeEnabled ? (
            <>
              <h3>Payment</h3>
              <p className="field-hint">
                You&apos;ll be taken to our payment provider to pay securely. The voucher code is issued the moment
                the payment clears.
              </p>
            </>
          ) : (
            <>
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
            </>
          )}
          {errors.card && <p className="field-error">{errors.card}</p>}
          {serverError && <p className="error-banner">{serverError}</p>}

          <div className="form-actions">
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Working…" : `${stripeEnabled ? "Continue to payment" : "Buy voucher"} — ${formatMoney(Number.isFinite(amountCents) ? amountCents : 0)}`}
            </button>
          </div>
        </form>

        <aside className="summary-card">
          <h2>Gift voucher</h2>
          <div className="summary-line">
            <span>Voucher value</span>
            <span>{formatMoney(Number.isFinite(amountCents) ? amountCents : 0)}</span>
          </div>
          <div className="summary-total">
            <span>Total</span>
            <span>{formatMoney(Number.isFinite(amountCents) ? amountCents : 0)}</span>
          </div>
          <p className="field-hint" style={{ marginTop: 12 }}>
            No tax is charged on the voucher itself — tax applies when it&apos;s spent on a room.
          </p>
        </aside>
      </div>
    </>
  );
}
