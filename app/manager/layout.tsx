import type { Metadata } from "next";
import Link from "next/link";
import ManagerNav from "@/components/manager/ManagerNav";

export const metadata: Metadata = {
  title: "Manager — Voltris Booking",
  robots: { index: false, follow: false }, // staff area: keep out of search engines
};

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mgr">
      <div className="mgr-topbar">
        <div className="mgr-topbar-inner">
          <span className="mgr-title">Manager portal</span>
          <Link href="/" className="mgr-view-site">
            View booking site →
          </Link>
        </div>
      </div>
      <ManagerNav />
      <div className="mgr-content">{children}</div>
    </div>
  );
}
