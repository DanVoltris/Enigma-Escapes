"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Permission } from "@/lib/permissions";

// `need` is the permission a tab requires; tabs without one are open to any
// signed-in staff. Hiding a tab is convenience only — the pages and APIs
// behind them re-check permission server-side.
const TABS: { href: string; label: string; need?: Permission | Permission[] }[] = [
  { href: "/manager", label: "Dashboard" },
  { href: "/manager/calendar", label: "Calendar", need: "calendar" },
  { href: "/manager/bookings", label: "Bookings", need: "bookings.view" },
  { href: "/manager/requests", label: "Requests", need: "requests" },
  { href: "/manager/customers", label: "Customers", need: "customers.view" },
  { href: "/manager/experiences", label: "Experiences", need: "experiences" },
  { href: "/manager/promos", label: "Promo codes", need: "promos" },
  { href: "/manager/checklists", label: "Checklists", need: "checklists" },
  { href: "/manager/notes", label: "Notes", need: "notes" },
  { href: "/manager/reports", label: "Reports", need: "reports" },
  { href: "/manager/settings", label: "Settings", need: ["settings", "staff"] },
  { href: "/manager/help", label: "Help" },
];

export default function ManagerNav({ permissions }: { permissions: Permission[] }) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/manager") return pathname === "/manager";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const visible = TABS.filter((tab) => {
    if (!tab.need) return true;
    const needed = Array.isArray(tab.need) ? tab.need : [tab.need];
    return needed.some((n) => permissions.includes(n));
  });

  return (
    <nav className="mgr-nav" aria-label="Manager sections">
      <div className="mgr-nav-inner">
        {visible.map((tab) => (
          <Link key={tab.href} href={tab.href} className={`mgr-tab${isActive(tab.href) ? " active" : ""}`}>
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
