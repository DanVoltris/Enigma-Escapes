"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart";
import type { CartItem, Customer } from "@/lib/types";

// Seeds the cart with the approved request's slot + details, remembers the
// token (checkout sends it so the server allows the sub-4h booking), then
// drops the customer into the normal checkout flow.
export default function RequestCompletion({
  token,
  item,
  customer,
}: {
  token: string;
  item: CartItem;
  customer: Customer;
}) {
  const router = useRouter();
  const { clear, addItem, setCustomer } = useCart();
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    clear();
    addItem(item);
    setCustomer(customer);
    try {
      window.sessionStorage.setItem("vb-request-token", token);
    } catch {}
    router.replace("/checkout");
  }, [clear, addItem, setCustomer, router, token, item, customer]);

  return <p className="empty-state">Setting up your booking…</p>;
}
