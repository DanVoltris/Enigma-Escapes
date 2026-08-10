"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CartSummary from "@/components/CartSummary";
import HoldBanner from "@/components/HoldBanner";
import ProgressSteps from "@/components/ProgressSteps";
import PromoField from "@/components/PromoField";
import { useCart } from "@/lib/cart";
import { trackInitiateCheckout } from "@/lib/tracking";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s()+-]{7,}$/;

type Errors = Partial<Record<"firstName" | "lastName" | "email" | "phone", string>>;

export default function CheckoutDetailsPage() {
  const router = useRouter();
  const { items, customer, setCustomer } = useCart();

  // Marketing funnel event, once per checkout visit — waits for the cart to
  // restore from localStorage (items start empty on first render).
  const checkoutTracked = useRef(false);
  useEffect(() => {
    if (items.length === 0 || checkoutTracked.current) return;
    checkoutTracked.current = true;
    trackInitiateCheckout(
      items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0),
      items.length
    );
  }, [items]);

  const [firstName, setFirstName] = useState(customer?.firstName ?? "");
  const [lastName, setLastName] = useState(customer?.lastName ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [subscribe, setSubscribe] = useState(customer?.subscribe ?? false);
  const [errors, setErrors] = useState<Errors>({});

  function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!firstName.trim()) next.firstName = "Enter your first name.";
    if (!lastName.trim()) next.lastName = "Enter your last name.";
    if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email address, e.g. name@example.com.";
    if (!PHONE_RE.test(phone.trim())) next.phone = "Enter a valid phone number with at least 7 digits.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setCustomer({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      subscribe,
    });
    // carry the request token forward when it is only on the URL (storage-less browsers)
    const rt = new URLSearchParams(window.location.search).get("rt");
    router.push(rt ? `/checkout/payment?rt=${encodeURIComponent(rt)}` : "/checkout/payment");
  }

  return (
    <>
      <ProgressSteps current={2} />
      <HoldBanner />

      {items.length === 0 ? (
        <div className="empty-state">
          <h1 className="page-title">Your cart is empty</h1>
          <p style={{ marginBottom: 24 }}>Add a booking first, then come back to check out.</p>
          <Link href="/" className="btn">
            Browse availability
          </Link>
        </div>
      ) : (
        <div className="checkout-grid">
          <div>
            <h1 className="section-title">Account information</h1>
            <form className="form-card" onSubmit={handleContinue} noValidate>
              <h3>Personal information</h3>
              <div className="field-row">
                <div className={`field ${errors.firstName ? "invalid" : ""}`}>
                  <label htmlFor="firstName">
                    First name <span className="req">*</span>
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                  />
                  {errors.firstName && <p className="field-error">{errors.firstName}</p>}
                </div>
                <div className={`field ${errors.lastName ? "invalid" : ""}`}>
                  <label htmlFor="lastName">
                    Last name <span className="req">*</span>
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                  />
                  {errors.lastName && <p className="field-error">{errors.lastName}</p>}
                </div>
              </div>
              <div className={`field ${errors.email ? "invalid" : ""}`}>
                <label htmlFor="email">
                  Email address <span className="req">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
                {errors.email && <p className="field-error">{errors.email}</p>}
              </div>
              <label className="checkbox-row">
                <input type="checkbox" checked={subscribe} onChange={(e) => setSubscribe(e.target.checked)} />
                <span>Subscribe to receive emails from us with the latest promotions and news.</span>
              </label>

              <h3>Contact information</h3>
              <div className={`field ${errors.phone ? "invalid" : ""}`}>
                <label htmlFor="phone">
                  Mobile phone <span className="req">*</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
                {errors.phone && <p className="field-error">{errors.phone}</p>}
              </div>

              <h3>Promo code</h3>
              <PromoField />

              <div className="form-actions">
                <button type="submit" className="btn">
                  Continue
                </button>
              </div>
            </form>
          </div>
          <CartSummary editable />
        </div>
      )}
    </>
  );
}
