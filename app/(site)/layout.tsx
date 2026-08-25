import { CartProvider } from "@/lib/cart";
import Header from "@/components/Header";
import { readableOn, shade, tint } from "@/lib/color";
import { activeTrackers, fbPixelScript, gtmScript } from "@/lib/integrations";
import { getIntegrations } from "@/lib/settings";
import { getCompanyName } from "@/lib/settings";
import { getSiteSettings } from "@/lib/site-settings";
import { SiteConfigProvider } from "@/lib/site-config";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Booking-site settings drive the theme, basket hold and on-site copy.
  const [site, integrations, company] = await Promise.all([
    getSiteSettings(),
    getIntegrations(),
    getCompanyName(),
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
          <Header company={company} />
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
          <footer className="site-footer">
            <a href="https://voltrisbooking.com" target="_blank" rel="noreferrer" className="powered-by">
              Powered by{" "}
              <span className="vb-mark">
                Voltris<span className="vb-mark-accent">Booking</span>
              </span>
            </a>
          </footer>
        </div>
      </CartProvider>
    </SiteConfigProvider>
  );
}
