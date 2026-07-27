"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { HOLD_MINUTES } from "./pricing";
import { trackAddToCart } from "./tracking";
import type { CartItem, Customer, PaymentOption } from "./types";

const STORAGE_KEY = "voltris-cart";

type AppliedPromo = { code: string; percentOff: number };

type CartState = {
  items: CartItem[];
  customer: Customer | null;
  promo: AppliedPromo | null; // validated against the server before being set
  paymentOption: PaymentOption;
  expiresAt: number | null; // epoch ms when the hold lapses
};

const EMPTY: CartState = {
  items: [],
  customer: null,
  promo: null,
  paymentOption: "deposit",
  expiresAt: null,
};

export function itemKey(i: { roomId: string; date: string; time: string }): string {
  return `${i.roomId}|${i.date}|${i.time}`;
}

type CartContextValue = CartState & {
  taxPercent: number;
  taxLabel: string;
  addItem: (item: CartItem) => void;
  removeItem: (key: string) => void;
  setCustomer: (customer: Customer) => void;
  setPromo: (promo: AppliedPromo | null) => void;
  setPaymentOption: (option: PaymentOption) => void;
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
  const loaded = useRef(false);
  // Kept in a ref so addItem stays a stable callback.
  const holdRef = useRef(holdMinutes);
  holdRef.current = holdMinutes;

  // The active tax rate/label, so totals match what the server will charge.
  const [taxPercent, setTaxPercent] = useState(5);
  const [taxLabel, setTaxLabel] = useState("Tax");
  useEffect(() => {
    fetch("/api/tax")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.percent === "number") setTaxPercent(d.percent);
        if (typeof d.label === "string") setTaxLabel(d.label);
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

  const setPaymentOption = useCallback((paymentOption: PaymentOption) => {
    setState((s) => ({ ...s, paymentOption }));
  }, []);

  const clear = useCallback(() => setState(EMPTY), []);

  return (
    <CartContext.Provider
      value={{ ...state, taxPercent, taxLabel, addItem, removeItem, setCustomer, setPromo, setPaymentOption, clear }}
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
