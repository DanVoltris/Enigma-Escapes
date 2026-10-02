import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { getCampaign, progressFor, sendNextBatch } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
// A batch is paced by Twilio at about a text a second, so this runs close to a
// minute. The page calls it again as soon as it answers.
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("marketing");
  if (guard.response) return guard.response;
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "That campaign no longer exists." }, { status: 404 });
  if (campaign.status !== "sending") {
    return NextResponse.json({ ...(await progressFor(id)), status: campaign.status, done: campaign.status === "done" });
  }
  try {
    const batch = await sendNextBatch(id, 25);
    const after = await getCampaign(id);
    return NextResponse.json({ ...batch, ...(await progressFor(id)), status: after?.status ?? "sending" });
  } catch (err) {
    console.error("sending a campaign batch failed:", err);
    return NextResponse.json({ error: "That batch didn't send. The campaign is paused where it got to." }, { status: 500 });
  }
}
