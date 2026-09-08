import { NextRequest, NextResponse } from "next/server";
import { cleanClientEvent, recordEvent, VISITOR_COOKIE } from "@/lib/events";

export const dynamic = "force-dynamic";

// Browser-sent funnel events. Public by necessity — it's the customer's
// browser calling — so it accepts as little as possible: an allowlisted event
// name with that event's own fields, a path, and the visitor cookie. Anything
// else is dropped. Same-site only, and small.
const MAX_BODY = 2048;

export async function POST(req: NextRequest) {
  // sendBeacon sends text/plain; fetch fallback does too. Never JSON-typed,
  // so this reads the raw body rather than trusting a content-type.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "same-site") {
    return new NextResponse(null, { status: 403 });
  }
  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BODY) return new NextResponse(null, { status: 400 });
  let body: { kind?: unknown; props?: unknown; path?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const clean = cleanClientEvent(body.kind, body.props);
  if (!clean) return new NextResponse(null, { status: 400 });
  const path = typeof body.path === "string" ? body.path.slice(0, 200) : null;
  // Not awaited past the write itself; a slow analytics write mustn't hold a
  // beacon open. recordEvent never throws.
  await recordEvent(clean.kind, clean.props, { visitor: req.cookies.get(VISITOR_COOKIE)?.value ?? null, path });
  return new NextResponse(null, { status: 204 });
}
