// Marketing integrations (Meta Pixel, Google Tag Manager): shape, defaults,
// validation and the injected script snippets. Pure module — no imports — so
// client components can use the type and validators without pulling server
// code into the browser bundle (see lib/site-settings-defaults.ts for the
// same pattern). The database read lives in lib/settings.ts (getIntegrations).

export type IntegrationSettings = {
  fbPixelId: string; // Meta Pixel ID, digits only; "" = not configured
  fbEnabled: boolean;
  gtmId: string; // Google Tag Manager container, "GTM-XXXXXXX"; "" = not configured
  gtmEnabled: boolean;
};

export const DEFAULT_INTEGRATIONS: IntegrationSettings = {
  fbPixelId: "",
  fbEnabled: false,
  gtmId: "",
  gtmEnabled: false,
};

// Meta Pixel IDs are numeric (typically 15-16 digits); GTM containers are
// GTM- plus 4-10 alphanumerics. Injection interpolates these into inline
// scripts, so the strict patterns double as the security guard.
export const FB_PIXEL_RE = /^\d{8,20}$/;
export const GTM_ID_RE = /^GTM-[A-Z0-9]{4,10}$/;

export function normalizeIntegrations(input: unknown): IntegrationSettings {
  const o = (input ?? {}) as Record<string, unknown>;
  const fbPixelId = typeof o.fbPixelId === "string" ? o.fbPixelId.trim() : "";
  const gtmId = typeof o.gtmId === "string" ? o.gtmId.trim().toUpperCase() : "";
  return {
    fbPixelId: FB_PIXEL_RE.test(fbPixelId) ? fbPixelId : "",
    fbEnabled: o.fbEnabled === true,
    gtmId: GTM_ID_RE.test(gtmId) ? gtmId : "",
    gtmEnabled: o.gtmEnabled === true,
  };
}

// A tracker only runs when it's switched on AND its ID passed validation.
export function activeTrackers(i: IntegrationSettings): { fb: boolean; gtm: boolean } {
  return {
    fb: i.fbEnabled && FB_PIXEL_RE.test(i.fbPixelId),
    gtm: i.gtmEnabled && GTM_ID_RE.test(i.gtmId),
  };
}

// Standard GTM loader. The ID is regex-validated before it gets here.
export function gtmScript(id: string): string {
  return (
    "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});" +
    "var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;" +
    "j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})" +
    `(window,document,'script','dataLayer','${id}');`
  );
}

// Standard Meta Pixel base code with the initial PageView.
export function fbPixelScript(id: string): string {
  return (
    "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?" +
    "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;" +
    "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;" +
    "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}" +
    "(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');" +
    `fbq('init','${id}');fbq('track','PageView');`
  );
}
