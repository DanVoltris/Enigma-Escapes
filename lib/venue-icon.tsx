import { ImageResponse } from "next/og";
import { readableOn } from "./color";
import { getCompanyName } from "./settings";
import { getSiteSettings } from "./site-settings";

// The venue's initial on its brand colour, at any size: the iPhone home-screen
// icon (app/apple-icon.tsx) and the staff app's icons for Android and for
// notifications (app/staff-icon). Read per request, not baked in at build:
// every venue deploys this same code.
export async function venueIcon(px: number): Promise<ImageResponse> {
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
          fontSize: Math.round(px * (2 / 3)),
          fontWeight: 700,
        }}
      >
        {letter}
      </div>
    ),
    { width: px, height: px }
  );
}
