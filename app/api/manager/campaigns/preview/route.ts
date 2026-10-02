import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { audienceCount, audienceSample, campaignText, countOptOuts, normalizeFilters, segmentsFor } from "@/lib/campaigns";
import { getCompanyName } from "@/lib/settings";

export const dynamic = "force-dynamic";

// How many people a set of filters reaches, and what the message will cost.
// Asked for on demand rather than as the manager types: it reads every booking.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("marketing");
  if (guard.response) return guard.response;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const filters = normalizeFilters(o.filters);
  const body = typeof o.body === "string" ? o.body : "";
  try {
    const [recipients, sample] = await Promise.all([audienceCount(filters), audienceSample(filters)]);
    const preview = campaignText(await getCompanyName(), body || "Your message goes here.");
    const { segments, unicode, characters } = segmentsFor(preview);
    return NextResponse.json({
      recipients,
      optedOut: await countOptOuts(),
      sample: sample.map((a) => ({
        name: a.name,
        phone: `•••-•••-${a.phone.slice(-4)}`,
        lastBooked: a.last_booked,
      })),
      preview,
      segments,
      unicode,
      characters,
    });
  } catch (err) {
    console.error("campaign preview failed:", err);
    return NextResponse.json({ error: "Could not work out who that reaches. Please try again." }, { status: 500 });
  }
}
