"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { DEFAULT_PRICING_MODE, HOLD_MINUTES, type PricingMode } from "./pricing";
import { trackAddToCart } from "./tracking";
import type { CartItem, Customer, PaymentOption } from "./types";

const STORAGE_KEY = "voltris-cart";

type AppliedPromo = { code: string; percentOff: number };
// A gift voucher is a prepaid balance, not a discount — it pays down the total
// after tax. remainingCents is what the server said was left when it was applied.
type AppliedVoucher = { code: string; remainingCents: number };

type CartState = {
  items: CartItem[];
  customer: Customer | null;
  promo: AppliedPromo | null; // validated against the server before being set
  voucher: AppliedVoucher | null; // ditto; stacks with a promo code
  paymentOption: PaymentOption;
  expiresAt: number | null; // epoch ms when the hold lapses
  // Token from an accepted sub-4h booking request. Lives here (not in
  // sessionStorage) so it survives reloads, tab changes and links opened from
  // a text message — checkout sends it so the server allows the booking.
  requestToken: string | null;
};

const EMPTY: CartState = {
  items: [],
  customer: null,
  promo: null,
  voucher: null,
  paymentOption: "deposit",
  expiresAt: null,
  requestToken: null,
};

export function itemKey(i: { roomId: string; date: string; time: string }): string {
  return `${i.roomId}|${i.date}|${i.time}`;
}

type CartContextValue = CartState & {
  hydrated: boolean; // true once the localStorage restore has run — seed AFTER this
  taxPercent: number;
  taxLabel: string;
  pricingMode: PricingMode;
  addItem: (item: CartItem) => void;
  removeItem: (key: string) => void;
  setCustomer: (customer: Customer) => void;
  setPromo: (promo: AppliedPromo | null) => void;
  setVoucher: (voucher: AppliedVoucher | null) => void;
  setPaymentOption: (option: PaymentOption) => void;
  setRequestToken: (token: string | null) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({
  children,
  holdMinutes = HOLD_MINUTES, // configurable in Settings → Booking site → Shopping basket
}: {
  children: React.ReactNode;
  holdMinutes?: number;
}) {
  const [state, setState] = useState<CartState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const loaded = useRef(false);
  // Kept in a ref so addItem stays a stable callback.
  const holdRef = useRef(holdMinutes);
  holdRef.current = holdMinutes;

  // The active tax rate/label, so totals match what the server will charge.
  const [taxPercent, setTaxPercent] = useState(5);
  const [taxLabel, setTaxLabel] = useState("Tax");
  const [pricingMode, setPricingMode] = useState<PricingMode>(DEFAULT_PRICING_MODE);
  useEffect(() => {
    fetch("/api/tax")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.percent === "number") setTaxPercent(d.percent);
        if (typeof d.label === "string") setTaxLabel(d.label);
        if (d.mode) setPricingMode(d.mode as PricingMode);
      })
      .catch(() => {});
  }, []);

  // Restore from localStorage after mount (avoids SSR hydration mismatch).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as CartState;
        const expired = saved.expiresAt !== null && saved.expiresAt <= Date.now();
        setState(expired ? EMPTY : { ...EMPTY, ...saved });
      }
    } catch {
      // corrupted storage — start fresh
    }
    loaded.current = true;
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage unavailable (private mode etc.) — cart still works in memory
    }
  }, [state]);

  const addItem = useCallback((item: CartItem) => {
    setState((s) => {
      const key = itemKey(item);
      const others = s.items.filter((i) => itemKey(i) !== key);
      return {
        ...s,
        items: [...others, item],
        expiresAt: s.items.length === 0 ? Date.now() + holdRef.current * 60 * 1000 : s.expiresAt,
      };
    });
    trackAddToCart(item); // marketing funnel event (no-op unless a tracker is active)
  }, []);

  const removeItem = useCallback((key: string) => {
    setState((s) => {
      const items = s.items.filter((i) => itemKey(i) !== key);
      return { ...s, items, expiresAt: items.length === 0 ? null : s.expiresAt };
    });
  }, []);

  const setCustomer = useCallback((customer: Customer) => {
    setState((s) => ({ ...s, customer }));
  }, []);

  const setPromo = useCallback((promo: AppliedPromo | null) => {
    setState((s) => ({ ...s, promo }));
  }, []);

  const setVoucher = useCallback((voucher: AppliedVoucher | null) => {
    setState((s) => ({ ...s, voucher }));
  }, []);

  const setPaymentOption = useCallback((paymentOption: PaymentOption) => {
    setState((s) => ({ ...s, paymentOption }));
  }, []);

  const setRequestToken = useCallback((requestToken: string | null) => {
    setState((s) => ({ ...s, requestToken }));
  }, []);

  const clear = useCallback(() => setState(EMPTY), []);

  return (
    <CartContext.Provider
      value={{
        ...state,
        hydrated,
        taxPercent,
        taxLabel,
        pricingMode,
        addItem,
        removeItem,
        setCustomer,
        setPromo,
        setVoucher,
        setPaymentOption,
        setRequestToken,
        clear,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
