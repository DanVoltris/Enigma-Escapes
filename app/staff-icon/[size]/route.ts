import { venueIcon } from "@/lib/venue-icon";

export const dynamic = "force-dynamic";

// The staff app's icons: 192 and 512 are the two sizes Android asks a manifest
// for (app/staff.webmanifest), and 192 is also the picture on a notification.
const SIZES = new Set([192, 512]);

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const px = Number((await params).size);
  if (!SIZES.has(px)) return new Response("Not found", { status: 404 });
  return venueIcon(px);
}
