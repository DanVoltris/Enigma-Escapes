"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart";

export default function HoldBanner() {
  const { items, expiresAt, clear } = useCart();
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (items.length > 0 && expiresAt !== null && expiresAt <= now) {
      clear();
      router.replace("/?expired=1");
    }
  }, [items.length, expiresAt, now, clear, router]);

  if (items.length === 0 || expiresAt === null) return null;

  const msLeft = Math.max(0, expiresAt - now);
  const totalSeconds = Math.floor(msLeft / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    <div className="hold-banner">
      <strong>Please note:</strong> your bookings are held for{" "}
      <span className="clock">
        {minutes}:{String(seconds).padStart(2, "0")}
      </span>{" "}
      — complete checkout before the hold expires.
    </div>
  );
}
