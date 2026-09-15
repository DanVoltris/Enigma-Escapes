import { getCompanyName } from "@/lib/settings";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

// What turns the staff portal, added to a home screen, into an app of its own:
// its own window with no browser bars, opening on the portal. iPhones only
// deliver notifications to a site added this way, so this is what makes phone
// notifications possible at all.
//
// Linked from the portal and the sign-in page only (not app/manifest.ts, which
// would apply to the whole site): a customer adding the booking site to their
// home screen should get the booking site, not a staff login.
//
// Served as a route rather than a static file because every venue runs this
// same code and each app is named after its own venue.
export async function GET() {
  const [company, site] = await Promise.all([getCompanyName(), getSiteSettings()]);
  const manifest = {
    id: "/manager",
    name: `${company} Staff`,
    short_name: company,
    start_url: "/manager",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: site.brandColor,
    icons: [
      { src: "/staff-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/staff-icon/512", sizes: "512x512", type: "image/png" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" },
  });
}
