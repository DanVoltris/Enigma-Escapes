import { CartProvider } from "@/lib/cart";
import Header from "@/components/Header";
import { getBusinessDetails } from "@/lib/settings";
import { getSiteSettings } from "@/lib/site-settings";
import { SiteConfigProvider } from "@/lib/site-config";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Business details come from Settings → Business details; the footer only
  // renders once the owner has filled them in. Booking-site settings drive the
  // theme, basket hold and on-site copy.
  const [business, site] = await Promise.all([
    getBusinessDetails()
      .then((r) => r.value)
      .catch(() => null),
    getSiteSettings(),
  ]);

  // Brand colours override the design tokens for the customer site only — the
  // manager portal keeps its own styling.
  const themeVars = `.site-theme{--accent:${site.brandColor};--btn-bg:${site.buttonBg};--btn-fg:${site.buttonText};}`;

  return (
    <SiteConfigProvider value={site}>
      <CartProvider holdMinutes={site.holdMinutes}>
        <style>{themeVars}</style>
        <div className="site-theme">
          <Header />
          <main className="container">
            {(site.introHeading || site.introText) && (
              <div className="site-intro">
                {site.introHeading && <h2>{site.introHeading}</h2>}
                {site.introText && <p>{site.introText}</p>}
              </div>
            )}
            {children}
            {site.supportText && <p className="site-support">{site.supportText}</p>}
          </main>
          {business?.companyName && (
            <footer className="site-footer">
              <div className="container inner">
                <strong>{business.companyName}</strong>
                {business.phone && <a href={`tel:${business.phone}`}>{business.phone}</a>}
                {business.email && <a href={`mailto:${business.email}`}>{business.email}</a>}
                {business.website && (
                  <a href={business.website} target="_blank" rel="noreferrer">
                    {business.website.replace(/^https?:\/\//, "")}
                  </a>
                )}
                {business.taxNumber && (
                  <span>
                    {business.taxLabel || "Tax"} #{business.taxNumber}
                  </span>
                )}
              </div>
            </footer>
          )}
        </div>
      </CartProvider>
    </SiteConfigProvider>
  );
}
