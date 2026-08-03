import type { Metadata } from "next";
import Link from "next/link";
import ManagerNav from "@/components/manager/ManagerNav";
import SignOutButton from "@/components/manager/SignOutButton";
import { requireStaff } from "@/lib/auth";
import { readableOn, shade, tint } from "@/lib/color";
import { getSiteSettings } from "@/lib/site-settings";

export const metadata: Metadata = {
  title: "Manager — Enigma Escapes",
  robots: { index: false, follow: false }, // staff area: keep out of search engines
};

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  // Everything under /manager requires a signed-in account. Individual pages
  // and APIs additionally check the specific permission they need.
  const staff = await requireStaff();

  // The owner's branding (Settings → Booking site → Logo & colours) also skins
  // the portal: logo in the top bar, brand colour as the accent. Hover/tint/
  // text-on-accent are derived from the brand colour so contrast stays readable.
  const site = await getSiteSettings();
  const themeVars = `.mgr{--accent:${site.brandColor};--accent-hover:${shade(site.brandColor, 0.85)};--accent-tint:${tint(site.brandColor, 0.92)};--accent-dark:${readableOn(site.brandColor)};--btn-bg:${site.buttonBg};--btn-fg:${site.buttonText};}`;

  const roleLabel = staff.role === "admin" ? "Admin" : staff.role === "manager" ? "Manager" : "Front desk";
  const scope = staff.locations.length > 0 ? staff.locations.join(", ") : "All locations";

  return (
    <div className="mgr">
      <style>{themeVars}</style>
      <div className="mgr-topbar">
        <div className="mgr-topbar-inner">
          <span className={`mgr-title${site.logoUrl ? " has-logo" : ""}`}>
            {site.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- data URLs in local mode
              <img src={site.logoUrl} alt="" className="mgr-logo" />
            )}
            Staff portal
          </span>
          <span className="mgr-whoami">
            <span className="who">
              <strong>{staff.name}</strong>
              <span className="sub">
                {roleLabel} · {scope}
              </span>
            </span>
            <Link href="/" className="mgr-view-site">
              View booking site →
            </Link>
            <SignOutButton />
          </span>
        </div>
      </div>
      <ManagerNav permissions={staff.permissions} />
      <div className="mgr-content">{children}</div>
    </div>
  );
}
