"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart";
import { useSiteConfig } from "@/lib/site-config";

export default function Header() {
  const { items } = useCart();
  const { logoUrl } = useSiteConfig();
  const count = items.length;

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URLs in local mode
            <img src={logoUrl} alt="Voltris Booking" className="brand-logo" />
          ) : (
            <>
              Voltris <span className="brand-accent">Booking</span>
            </>
          )}
        </Link>
        <div className="header-right">
          <Link href="/" className="header-home-link">
            Back to home
          </Link>
          <Link href="/manager" className="header-home-link">
            Manager
          </Link>
          <Link href="/checkout" className="cart-button" aria-label={`Cart, ${count} booking(s)`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 6h2l2.4 12h9.2L19 9H6" />
              <circle cx="9" cy="21" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="16" cy="21" r="1.5" fill="currentColor" stroke="none" />
            </svg>
            Cart ({count})
          </Link>
        </div>
      </div>
    </header>
  );
}
