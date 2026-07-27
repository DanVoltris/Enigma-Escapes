import { CartProvider } from "@/lib/cart";
import Header from "@/components/Header";
import { readableOn, shade, tint } from "@/lib/color";
import { activeTrackers, fbPixelScript, gtmScript } from "@/lib/integrations";
import { getBusinessDetails, getIntegrations } from "@/lib/settings";
import { getSiteSettings } from "@/lib/site-settings";
import { SiteConfigProvider } from "@/lib/site-config";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Business details come from Settings → Business details; the footer only
  // renders once the owner has filled them in. Booking-site settings drive the
  // theme, basket hold and on-site copy.
  const [business, site, integrations] = await Promise.all([
    getBusinessDetails()
      .then((r) => r.value)
      .catch(() => null),
    getSiteSettings(),
    getIntegrations(),
  ]);

  // Marketing scripts (Settings → Integrations) run on the customer site only,
  // and only with a validated ID — the IDs are interpolated into inline
  // scripts, so nothing unvalidated may reach them.
  const trackers = activeTrackers(integrations);

  // Brand colours override the design tokens for the customer site. Hover/tint/
  // text-on-accent are derived from the brand colour so contrast stays readable.
  const themeVars = `.site-theme{--accent:${site.brandColor};--accent-hover:${shade(site.brandColor, 0.85)};--accent-tint:${tint(site.brandColor, 0.92)};--accent-dark:${readableOn(site.brandColor)};--btn-bg:${site.buttonBg};--btn-fg:${site.buttonText};}`;

  return (
    <SiteConfigProvider value={site}>
      <CartProvider holdMinutes={site.holdMinutes}>
        <style>{themeVars}</style>
        {trackers.gtm && (
          <>
            <script dangerouslySetInnerHTML={{ __html: gtmScript(integrations.gtmId) }} />
            <noscript>
              <iframe
                src={`https://www.googletagmanager.com/ns.html?id=${integrations.gtmId}`}
                height="0"
                width="0"
                style={{ display: "none", visibility: "hidden" }}
                title="Google Tag Manager"
              />
            </noscript>
          </>
        )}
        {trackers.fb && (
          <>
            <script dangerouslySetInnerHTML={{ __html: fbPixelScript(integrations.fbPixelId) }} />
            <noscript>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                height="1"
                width="1"
                style={{ display: "none" }}
                src={`https://www.facebook.com/tr?id=${integrations.fbPixelId}&ev=PageView&noscript=1`}
                alt=""
              />
            </noscript>
          </>
        )}
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
