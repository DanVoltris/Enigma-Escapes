import Link from "next/link";
import { notFound } from "next/navigation";
import CampaignRun from "@/components/manager/CampaignRun";
import { requirePermission } from "@/lib/auth";
import { getCampaign, progressFor } from "@/lib/campaigns";
import { campaignText, segmentsFor } from "@/lib/campaign-text";
import { getSmsRateCents } from "@/lib/sms-rate";
import { getCompanyName } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("marketing", "/manager/marketing");
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  const [progress, company, rateCents] = await Promise.all([progressFor(id), getCompanyName(), getSmsRateCents()]);
  const message = campaignText(company, campaign.body);
  // What it actually cost: texts sent, each charged as however many segments
  // the message takes. This is the figure to check the next estimate against.
  const { segments, characters } = segmentsFor(message);
  const charged = progress.sent * segments;
  const spent = (charged * rateCents) / 100;

  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/marketing">← Back to marketing</Link>
      </p>
      <h1 className="mgr-page-title">{campaign.name}</h1>
      <p className="mgr-page-sub">
        {campaign.audience.months === null
          ? "Everyone who has ever booked"
          : `Booked in the last ${campaign.audience.months} months`}
        {campaign.audience.includeSubscribers && ", plus subscribers"}
        {campaign.audience.areaCodes.length > 0 && ` · ${campaign.audience.areaCodes.join(", ")}`}
        {campaign.audience.locations.length > 0 && ` · ${campaign.audience.locations.join(", ")}`}
      </p>

      <CampaignRun id={campaign.id} status={campaign.status} initialProgress={progress} message={message} />

      <div className="mgr-card">
        <h2>What it cost</h2>
        <p className="card-sub">
          {characters} characters, so each person is charged as {segments} text{segments === 1 ? "" : "s"}.{" "}
          {progress.sent.toLocaleString()} sent × {segments} ={" "}
          <strong>{charged.toLocaleString()} charged texts</strong>, about <strong>${spent.toFixed(2)}</strong> at{" "}
          {rateCents}¢ each.
          {campaign.startedAt && campaign.finishedAt && (
            <>
              {" "}
              It took{" "}
              {Math.max(
                1,
                Math.round((Date.parse(campaign.finishedAt) - Date.parse(campaign.startedAt)) / 60000)
              )}{" "}
              minutes.
            </>
          )}
        </p>
        <p className="field-hint">
          The price per text is yours to set on the Marketing page — Twilio&apos;s own invoice is the last word.
        </p>
      </div>
    </>
  );
}
