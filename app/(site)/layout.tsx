import Link from "next/link";
import { cookies } from "next/headers";
import { CartProvider } from "@/lib/cart";
import Header from "@/components/Header";
import ConsentBanner from "@/components/ConsentBanner";
import ConsentLink from "@/components/ConsentLink";
import VisitorId from "@/components/VisitorId";
import { readableOn, shade, tint } from "@/lib/color";
import { CONSENT_COOKIE, consentState, parseConsent, trackerKeys } from "@/lib/consent";
import { activeTrackers, fbPixelScript, gtmScript } from "@/lib/integrations";
import { getIntegrations } from "@/lib/settings";
import { getCompanyName } from "@/lib/settings";
import { getSiteSettings } from "@/lib/site-settings";
import { SiteConfigProvider } from "@/lib/site-config";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Booking-site settings drive the theme, basket hold and on-site copy.
  const [site, integrations, company, jar] = await Promise.all([
    getSiteSettings(),
    getIntegrations(),
    getCompanyName(),
    cookies(),
  ]);

  // Marketing scripts (Settings → Integrations) run on the customer site only,
  // and only with a validated ID — the IDs are interpolated into inline
  // scripts, so nothing unvalidated may reach them.
  const trackers = activeTrackers(integrations);

  // ...and only for a visitor who has said yes. The decision is a cookie, so it
  // is known here, while the page is being built: a declining visitor's HTML
  // never contains the snippets at all, rather than containing them and being
  // asked to behave. With no tracker switched on there is nothing to consent to
  // and no banner appears — which is every venue's state until someone enables
  // one in Settings → Marketing & tracking.
  const consent = consentState(trackers, parseConsent(jar.get(CONSENT_COOKIE)?.value));
  const track = { fb: trackers.fb && consent.allow, gtm: trackers.gtm && consent.allow };

  // Brand colours override the design tokens for the customer site. Hover/tint/
  // text-on-accent are derived from the brand colour so contrast stays readable.
  const themeVars = `.site-theme{--accent:${site.brandColor};--accent-hover:${shade(site.brandColor, 0.85)};--accent-tint:${tint(site.brandColor, 0.92)};--accent-dark:${readableOn(site.brandColor)};--btn-bg:${site.buttonBg};--btn-fg:${site.buttonText};}`;

  return (
    <SiteConfigProvider value={site}>
      <CartProvider holdMinutes={site.holdMinutes}>
        <VisitorId />
        <style>{themeVars}</style>
        {track.gtm && (
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
        {track.fb && (
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
            <Link href="/privacy" className="site-footer-link">
              Privacy policy
            </Link>
            {consent.required && <ConsentLink />}
            <a href="https://voltrisbooking.com" target="_blank" rel="noreferrer" className="powered-by">
              Powered by{" "}
              <span className="vb-mark">
                Voltris<span className="vb-mark-accent">Booking</span>
              </span>
            </a>
          </footer>
          {consent.required && (
            <ConsentBanner
              covers={trackerKeys(trackers)}
              initiallyOpen={consent.ask}
              loaded={consent.allow}
            />
          )}
        </div>
      </CartProvider>
    </SiteConfigProvider>
  );
}
