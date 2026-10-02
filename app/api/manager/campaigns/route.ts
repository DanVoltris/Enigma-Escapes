import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { createCampaign, listCampaigns, normalizeFilters, segmentsFor, campaignText } from "@/lib/campaigns";
import { logActivity } from "@/lib/db";
import { getCompanyName } from "@/lib/settings";
import { smsConfigured } from "@/lib/sms";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard("marketing");
  if (guard.response) return guard.response;
  return NextResponse.json({ campaigns: await listCampaigns() });
}

// Write a campaign and the list of numbers it goes to. Nothing is sent here —
// a campaign starts out as a draft, and sending is a separate, deliberate act.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("marketing");
  if (guard.response) return guard.response;
  if (!smsConfigured()) {
    return NextResponse.json({ error: "Texting isn't set up for this venue yet." }, { status: 503 });
  }
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  const body = typeof o.body === "string" ? o.body.trim() : "";
  if (!name) return NextResponse.json({ error: "Give the campaign a name, so you can find it later." }, { status: 400 });
  if (body.length < 10) return NextResponse.json({ error: "Write the message customers will read." }, { status: 400 });
  if (body.length > 1000) return NextResponse.json({ error: "That message is too long for a text." }, { status: 400 });

  const filters = normalizeFilters(o.filters);
  try {
    const { campaign, recipients } = await createCampaign({
      name,
      body,
      filters,
      createdBy: guard.staff.name || guard.staff.email,
    });
    const { segments } = segmentsFor(campaignText(await getCompanyName(), body));
    await logActivity(
      "Campaign created",
      `${name} — ${recipients} recipient(s), ${segments} segment(s) each, by ${guard.staff.name}`
    );
    return NextResponse.json({ campaign, recipients }, { status: 201 });
  } catch (err) {
    console.error("creating the campaign failed:", err);
    return NextResponse.json({ error: "Could not create the campaign right now. Please try again." }, { status: 500 });
  }
}
