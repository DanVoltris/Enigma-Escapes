import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { campaignText } from "@/lib/campaigns";
import { getCompanyName } from "@/lib/settings";
import { sendCampaignText, smsConfigured } from "@/lib/sms";

export const dynamic = "force-dynamic";

// Send the message to one number — your own phone — before thousands of people
// read it. Doesn't touch the campaign or its list.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("marketing");
  if (guard.response) return guard.response;
  if (!smsConfigured()) {
    return NextResponse.json({ error: "Texting isn't set up for this venue yet." }, { status: 503 });
  }
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const to = typeof o.phone === "string" ? o.phone : "";
  const body = typeof o.body === "string" ? o.body.trim() : "";
  if (to.replace(/\D/g, "").length < 10) {
    return NextResponse.json({ error: "Enter the phone number to test on." }, { status: 400 });
  }
  if (body.length < 10) return NextResponse.json({ error: "Write the message first." }, { status: 400 });
  const result = await sendCampaignText(to, campaignText(await getCompanyName(), body));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
