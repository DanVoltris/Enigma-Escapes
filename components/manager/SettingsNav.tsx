"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Resova-style grouped settings rail. Each entry is its own route under
// /manager/settings; the shared layout puts this beside the page content.
const SECTIONS: { heading: string; items: { href: string; label: string }[] }[] = [
  {
    heading: "Business settings",
    items: [
      { href: "/manager/settings/business", label: "Business details" },
      { href: "/manager/settings/store-hours", label: "Locations & hours" },
      { href: "/manager/settings/taxes", label: "Taxes & fees" },
      { href: "/manager/settings/locale", label: "Locale & formatting" },
    ],
  },
  {
    heading: "Team settings",
    items: [{ href: "/manager/settings/team", label: "Team & permissions" }],
  },
  {
    heading: "Booking site",
    items: [{ href: "/manager/settings/booking-site", label: "Appearance & basket" }],
  },
  {
    heading: "Visitor settings",
    items: [
      { href: "/manager/settings/customer-accounts", label: "Customer accounts" },
      { href: "/manager/settings/waivers", label: "Waivers" },
    ],
  },
  {
    heading: "Booking & payments",
    items: [{ href: "/manager/settings/payments", label: "Payment settings" }],
  },
  {
    heading: "Integrations",
    items: [{ href: "/manager/settings/integrations", label: "Marketing & tracking" }],
  },
  {
    heading: "Developers",
    items: [{ href: "/manager/settings/developers", label: "API keys" }],
  },
];

export default function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="rpt-nav" aria-label="Settings sections">
      {SECTIONS.map((s) => (
        <div key={s.heading}>
          <h3>{s.heading}</h3>
          <ul>
            {s.items.map((t) => (
              <li key={t.href}>
                <Link href={t.href} className={pathname === t.href ? "active" : undefined}>
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
