import { venueIcon } from "@/lib/venue-icon";

// The icon an iPhone uses when someone adds the site to their home screen. With
// none, iOS draws the first letter of the page title — "M" for every portal
// page ("Manager — …"). This is the venue's own initial on its brand colour
// (lib/venue-icon.tsx, shared with the staff app's Android icons).
export const dynamic = "force-dynamic";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  return venueIcon(size.width);
}
