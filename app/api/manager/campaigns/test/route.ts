import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { campaignText } from "@/lib/campaigns";
import { logActivity } from "@/lib/db";
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
  // Logged so a text that turns up on someone's phone can always be accounted
  // for — without this, a test looked exactly like a campaign nobody can find.
  await logActivity("Campaign test sent", `to ${to} by ${guard.staff.name || guard.staff.email}`).catch(() => null);
  return NextResponse.json({ ok: true });
}
