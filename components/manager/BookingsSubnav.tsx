"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Bookings and Invoices are the same job seen from two sides — money owed
// before a booking exists, and bookings that already do. They share a subtab
// row rather than a sixteenth top-level tab, which the nav has no room for.
const TABS = [
  { href: "/manager/bookings", label: "Bookings" },
  { href: "/manager/invoices", label: "Invoices" },
];

export default function BookingsSubnav() {
  const path = usePathname();
  return (
    <div className="mgr-subtabs">
      {TABS.map((t) => {
        const active = t.href === "/manager/bookings" ? path === t.href : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`mgr-subtab${active ? " active" : ""}`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
