"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CartSummary from "@/components/CartSummary";
import HoldBanner from "@/components/HoldBanner";
import ProgressSteps from "@/components/ProgressSteps";
import { useCart } from "@/lib/cart";
import { formatMoney } from "@/lib/format";
import { amountDueCents, computeTotals } from "@/lib/pricing";

// The manager-approved token that lets the server accept a sub-4h booking.
// Held in the cart (persisted), with the URL as a fallback for browsers where
// storage is unavailable — e.g. a link opened inside the Messages app.
function tokenFromUrl(): string | undefined {
  try {
    return new URLSearchParams(window.location.search).get("rt") ?? undefined;
  } catch {
    return undefined;
  }
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

type CardErrors = Partial<Record<"cardName" | "cardNumber" | "expiry" | "cvc", string>>;

// Input masks: keep digits only and insert the separators cards print
// themselves — a space every 4 digits, a slash after the expiry month.
function formatCardNumber(v: string): string {
  const digits = v.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}
function formatExpiry(v: string): string {
  const digits = v.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`;
}
function formatCvc(v: string): string {
  return v.replace(/\D/g, "").slice(0, 4);
}

// stripeEnabled: real payment via Stripe-hosted checkout (keys configured in
// the environment). Otherwise the simulated card form — validated locally,
// nobody charged. canceled: the customer backed out of Stripe checkout.
export default function PaymentForm({ stripeEnabled, canceled }: { stripeEnabled: boolean; canceled: boolean }) {
  const router = useRouter();
  const { items, customer, promo, paymentOption, taxPercent, pricingMode, requestToken, setPromo, setPaymentOption, clear } = useCart();

  const [promoOpen, setPromoOpen] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);

  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [cardErrors, setCardErrors] = useState<CardErrors>({});

  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Payment needs contact details first — send the user back if they skipped step 2.
  useEffect(() => {
    if (items.length > 0 && !customer) router.replace("/checkout");
  }, [items.length, customer, router]);

  const totals = computeTotals(items, promo?.percentOff ?? 0, taxPercent, pricingMode);
  // Only offer the deposit option when it's actually less than the full amount
  // (an all-100%-deposit cart requires full payment up front).
  const depositOffered = totals.depositCents < totals.totalCents;
  useEffect(() => {
    if (!depositOffered && paymentOption === "deposit") setPaymentOption("full");
  }, [depositOffered, paymentOption, setPaymentOption]);
  const dueNow = amountDueCents(totals, paymentOption);

  async function applyPromo() {
    const code = promoInput.trim().toUpperCase();
    if (!code || promoChecking) return;
    setPromoChecking(true);
    setPromoError(null);
    try {
      const res = await fetch(`/api/promo?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not check the code. Try again.");
      setPromo({ code: data.code, percentOff: data.percentOff });
    } catch (err) {
      setPromoError(err instanceof Error ? err.message : "Could not check the code. Try again.");
    } finally {
      setPromoChecking(false);
    }
  }

  // Stripe path: server revalidates the cart, holds the spots and returns the
  // hosted checkout URL. The cart is kept — it clears on the confirmation page.
  async function payWithStripe() {
    setServerError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, customer, paymentOption, promoCode: promo?.code ?? null, requestToken: requestToken ?? tokenFromUrl() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the payment. Please try again.");
      window.location.assign(data.url as string);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  async function completeBooking(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    const digits = cardNumber.replace(/[\s-]/g, "");
    const expiryMatch = expiry.trim().match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/);
    const next: CardErrors = {};
    if (!cardName.trim()) next.cardName = "Enter the name shown on the card.";
    if (!/^\d{13,19}$/.test(digits) || !luhnValid(digits)) {
      next.cardNumber = "Enter a valid card number (13–19 digits).";
    }
    if (!expiryMatch) {
      next.expiry = "Enter the expiry as MM/YY, e.g. 09/28.";
    } else {
      const [, mm, yy] = expiryMatch;
      const endOfMonth = new Date(2000 + Number(yy), Number(mm), 1);
      if (endOfMonth <= new Date()) next.expiry = "This card has expired. Use a different card.";
    }
    if (!/^\d{3,4}$/.test(cvc.trim())) next.cvc = "Enter the 3 or 4 digit security code.";
    setCardErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      // Simulated payment: card details are validated locally and never leave the browser.
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, customer, paymentOption, promoCode: promo?.code ?? null, requestToken: requestToken ?? tokenFromUrl() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong completing your booking.");
      clear(); // also drops the request token
      router.push(`/confirmation/${data.id}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (items.length === 0) {
    return (
      <>
        <ProgressSteps current={3} />
        <div className="empty-state">
          <h1 className="page-title">Your cart is empty</h1>
          <p>Add a booking first, then come back to check out.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <ProgressSteps current={3} />
      <HoldBanner />

      <div className="checkout-grid">
        <div>
          <h1 className="section-title">Payment</h1>

          {canceled && (
            <div className="error-banner">
              Payment was cancelled — you have not been charged. Your selections are still held below.
            </div>
          )}

          <div className="promo-box">
            <button type="button" className="promo-toggle" onClick={() => setPromoOpen((o) => !o)}>
              Have a promo or gift code?
              <span aria-hidden="true">{promoOpen ? "▴" : "▾"}</span>
            </button>
            {promoOpen && (
              <>
                <div className="promo-form">
                  <input
                    type="text"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value)}
                    placeholder="Enter code"
                    aria-label="Promo or gift code"
                  />
                  <button type="button" className="btn" onClick={applyPromo} disabled={promoChecking}>
                    {promoChecking ? "Checking…" : "Apply"}
                  </button>
                </div>
                {promo && (
                  <p className="promo-note ok">
                    Code {promo.code} applied — you saved {formatMoney(totals.discountCents)}.{" "}
                    <button type="button" className="link-button" onClick={() => setPromo(null)}>
                      Remove
                    </button>
                  </p>
                )}
                {promoError && <p className="promo-note err">{promoError}</p>}
              </>
            )}
          </div>

          <h3 className="section-title" style={{ fontSize: 17 }}>
            Payment options
          </h3>
          <div className="pay-options">
            <label className={`pay-option ${paymentOption === "full" ? "selected" : ""}`}>
              <input
                type="radio"
                name="paymentOption"
                checked={paymentOption === "full"}
                onChange={() => setPaymentOption("full")}
              />
              <span>
                Pay full balance — <span className="amount">{formatMoney(totals.totalCents)}</span>
              </span>
            </label>
            {depositOffered && (
              <label className={`pay-option ${paymentOption === "deposit" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="paymentOption"
                  checked={paymentOption === "deposit"}
                  onChange={() => setPaymentOption("deposit")}
                />
                <span>
                  Pay deposit — <span className="amount">{formatMoney(totals.depositCents)}</span>
                  <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>
                    {" "}
                    (then {formatMoney(totals.totalCents - totals.depositCents)} at the venue)
                  </span>
                </span>
              </label>
            )}
          </div>

          {stripeEnabled ? (
            <div className="form-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <h3 style={{ margin: 0 }}>Secure card payment</h3>
                <div className="card-brands" aria-hidden="true">
                  <span>VISA</span>
                  <span>MASTERCARD</span>
                  <span>AMEX</span>
                </div>
              </div>
              <p style={{ color: "var(--text-secondary)", marginBottom: 20 }}>
                You&apos;ll be taken to Stripe&apos;s secure checkout to pay — cards and wallets like Apple Pay and
                Google Pay, depending on your device. Your spots stay held while you pay.
              </p>

              {serverError && <div className="error-banner">{serverError}</div>}

              <div className="form-actions">
                <button type="button" className="btn" onClick={payWithStripe} disabled={submitting}>
                  {submitting ? "Redirecting…" : `Pay ${formatMoney(dueNow)} securely`}
                </button>
              </div>
            </div>
          ) : (
            <form className="form-card" onSubmit={completeBooking} noValidate>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <h3 style={{ margin: 0 }}>Card payment</h3>
                <div className="card-brands" aria-hidden="true">
                  <span>VISA</span>
                  <span>MASTERCARD</span>
                  <span>AMEX</span>
                </div>
              </div>
              <p style={{ color: "var(--text-secondary)", marginBottom: 20 }}>
                This is a simulated payment for testing — no real charge is made and card details never leave your
                browser.
              </p>

              {serverError && <div className="error-banner">{serverError}</div>}

              <div className={`field ${cardErrors.cardName ? "invalid" : ""}`}>
                <label htmlFor="cardName">
                  Name on card <span className="req">*</span>
                </label>
                <input
                  id="cardName"
                  type="text"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  autoComplete="cc-name"
                />
                {cardErrors.cardName && <p className="field-error">{cardErrors.cardName}</p>}
              </div>
              <div className={`field ${cardErrors.cardNumber ? "invalid" : ""}`}>
                <label htmlFor="cardNumber">
                  Card number <span className="req">*</span>
                </label>
                <input
                  id="cardNumber"
                  type="text"
                  inputMode="numeric"
                  placeholder="4242 4242 4242 4242"
                  value={cardNumber}
                  maxLength={23}
                  onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                  autoComplete="cc-number"
                />
                {cardErrors.cardNumber && <p className="field-error">{cardErrors.cardNumber}</p>}
              </div>
              <div className="field-row">
                <div className={`field ${cardErrors.expiry ? "invalid" : ""}`}>
                  <label htmlFor="expiry">
                    Expiry (MM/YY) <span className="req">*</span>
                  </label>
                  <input
                    id="expiry"
                    type="text"
                    inputMode="numeric"
                    placeholder="09/28"
                    value={expiry}
                    maxLength={5}
                    onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                    autoComplete="cc-exp"
                  />
                  {cardErrors.expiry && <p className="field-error">{cardErrors.expiry}</p>}
                </div>
                <div className={`field ${cardErrors.cvc ? "invalid" : ""}`}>
                  <label htmlFor="cvc">
                    Security code <span className="req">*</span>
                  </label>
                  <input
                    id="cvc"
                    type="text"
                    inputMode="numeric"
                    placeholder="123"
                    value={cvc}
                    maxLength={4}
                    onChange={(e) => setCvc(formatCvc(e.target.value))}
                    autoComplete="cc-csc"
                  />
                  {cardErrors.cvc && <p className="field-error">{cardErrors.cvc}</p>}
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn" disabled={submitting}>
                  {submitting ? "Processing…" : `Complete booking — ${formatMoney(dueNow)}`}
                </button>
              </div>
            </form>
          )}
        </div>
        <CartSummary editable showCustomer />
      </div>
    </>
  );
}
