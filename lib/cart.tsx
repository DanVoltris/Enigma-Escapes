"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { HOLD_MINUTES } from "./pricing";
import type { CartItem, Customer, PaymentOption } from "./types";

const STORAGE_KEY = "voltris-cart";

type CartState = {
  items: CartItem[];
  customer: Customer | null;
  promoCode: string | null;
  paymentOption: PaymentOption;
  expiresAt: number | null; // epoch ms when the hold lapses
};

const EMPTY: CartState = {
  items: [],
  customer: null,
  promoCode: null,
  paymentOption: "deposit",
  expiresAt: null,
};

export function itemKey(i: { roomId: string; date: string; time: string }): string {
  return `${i.roomId}|${i.date}|${i.time}`;
}

type CartContextValue = CartState & {
  addItem: (item: CartItem) => void;
  removeItem: (key: string) => void;
  setCustomer: (customer: Customer) => void;
  setPromoCode: (code: string | null) => void;
  setPaymentOption: (option: PaymentOption) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>(EMPTY);
  const loaded = useRef(false);

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
        expiresAt: s.items.length === 0 ? Date.now() + HOLD_MINUTES * 60 * 1000 : s.expiresAt,
      };
    });
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

  const setPromoCode = useCallback((promoCode: string | null) => {
    setState((s) => ({ ...s, promoCode }));
  }, []);

  const setPaymentOption = useCallback((paymentOption: PaymentOption) => {
    setState((s) => ({ ...s, paymentOption }));
  }, []);

  const clear = useCallback(() => setState(EMPTY), []);

  return (
    <CartContext.Provider
      value={{ ...state, addItem, removeItem, setCustomer, setPromoCode, setPaymentOption, clear }}
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
