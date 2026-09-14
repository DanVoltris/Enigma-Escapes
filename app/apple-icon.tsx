import { ImageResponse } from "next/og";
import { readableOn } from "@/lib/color";
import { getCompanyName } from "@/lib/settings";
import { getSiteSettings } from "@/lib/site-settings";

// The icon an iPhone uses when someone adds the site to their home screen. With
// none, iOS draws the first letter of the page title — "M" for every portal
// page ("Manager — …"). This is the venue's own initial on its brand colour.
// Read per request, not baked in at build: every venue deploys this same code.
export const dynamic = "force-dynamic";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const [company, site] = await Promise.all([getCompanyName(), getSiteSettings()]);
  const letter = company.trim().charAt(0).toUpperCase() || "B";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: site.brandColor,
          color: readableOn(site.brandColor),
          fontSize: 120,
          fontWeight: 700,
        }}
      >
        {letter}
      </div>
    ),
    size
  );
}
