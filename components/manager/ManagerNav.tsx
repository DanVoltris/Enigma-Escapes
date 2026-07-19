"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/manager", label: "Dashboard" },
  { href: "/manager/calendar", label: "Calendar" },
  { href: "/manager/bookings", label: "Bookings" },
  { href: "/manager/customers", label: "Customers" },
  { href: "/manager/experiences", label: "Experiences" },
  { href: "/manager/promos", label: "Promo codes" },
  { href: "/manager/reports", label: "Reports" },
  { href: "/manager/help", label: "Help" },
];

export default function ManagerNav() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/manager") return pathname === "/manager";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="mgr-nav" aria-label="Manager sections">
      <div className="mgr-nav-inner">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} className={`mgr-tab${isActive(tab.href) ? " active" : ""}`}>
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
