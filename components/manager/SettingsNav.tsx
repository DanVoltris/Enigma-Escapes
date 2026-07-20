"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SUBTABS = [
  { href: "/manager/settings/store-hours", label: "Store hours" },
  { href: "/manager/settings/taxes", label: "Taxes" },
];

export default function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="mgr-subtabs" aria-label="Settings sections">
      {SUBTABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`mgr-subtab${pathname === t.href ? " active" : ""}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
