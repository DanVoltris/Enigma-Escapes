import { ImageResponse } from "next/og";
import { readableOn } from "./color";
import { getCompanyName } from "./settings";
import { getSiteSettings } from "./site-settings";
import { publicImageBase } from "./storage";

// The venue's icon at any size: the iPhone home-screen icon (app/apple-icon.tsx)
// and the staff app's icons for Android and notifications (app/staff-icon).
// Read per request, not baked in at build: every venue deploys this same code.
//
// In order of preference:
//   1. the square app icon uploaded in Settings → Booking site → Logo & colours,
//      filling the whole icon;
//   2. the logo, fitted inside with a margin (wide logos come out small, which
//      is why the app icon exists);
//   3. the venue's initial on its brand colour.
export async function venueIcon(px: number): Promise<ImageResponse> {
  const [company, site] = await Promise.all([getCompanyName(), getSiteSettings()]);
  const size = { width: px, height: px };

  const appIcon = site.appIconUrl ? await loadImage(site.appIconUrl) : null;
  if (appIcon) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- rendered to a PNG, not a page */}
          <img src={appIcon} width={px} height={px} style={{ objectFit: "cover" }} alt="" />
        </div>
      ),
      size
    );
  }

  const logo = site.logoUrl ? await loadImage(site.logoUrl) : null;
  if (logo) {
    const inner = Math.round(px * 0.8);
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#ffffff",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- rendered to a PNG, not a page */}
          <img src={logo} width={inner} height={inner} style={{ objectFit: "contain" }} alt="" />
        </div>
      ),
      size
    );
  }

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
    size
  );
}

// The image as a data URL the renderer can draw, or null to fall back to the
// next option. Only our own uploads (the same rule the settings save applies),
// only PNG or JPEG (the renderer can't read WebP), and never long enough to
// hold up a home screen: a broken picture should cost the icon, not the page.
async function loadImage(url: string): Promise<string | null> {
  if (url.startsWith("data:")) return /^data:image\/(png|jpeg);base64,/.test(url) ? url : null;
  if (!url.startsWith(publicImageBase())) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!res.ok || (type !== "image/png" && type !== "image/jpeg")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
