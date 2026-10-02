import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { getCampaign, progressFor, setCampaignStatus } from "@/lib/campaigns";
import { logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("marketing");
  if (guard.response) return guard.response;
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "That campaign no longer exists." }, { status: 404 });
  return NextResponse.json({ campaign, progress: await progressFor(id) });
}

// Start, pause or resume. Starting is the moment customers get texted, so it is
// its own action with its own confirmation in the portal.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("marketing");
  if (guard.response) return guard.response;
  const { id } = await params;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = o.status === "sending" || o.status === "paused" || o.status === "done" ? o.status : null;
  if (!status) return NextResponse.json({ error: "Say whether to start, pause or stop it." }, { status: 400 });

  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "That campaign no longer exists." }, { status: 404 });
  if (campaign.status === "done") {
    return NextResponse.json({ error: "That campaign has already finished." }, { status: 400 });
  }
  try {
    await setCampaignStatus(id, status);
    const progress = await progressFor(id);
    if (status === "sending" && campaign.status === "draft") {
      await logActivity("Campaign started", `${campaign.name} — ${progress.pending} to text, by ${guard.staff.name}`);
    }
    if (status === "paused") await logActivity("Campaign paused", `${campaign.name} — ${progress.sent} sent so far`);
    return NextResponse.json({ ok: true, progress });
  } catch (err) {
    console.error("changing the campaign status failed:", err);
    return NextResponse.json({ error: "Could not do that right now. Please try again." }, { status: 500 });
  }
}
