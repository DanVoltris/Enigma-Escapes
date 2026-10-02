import Link from "next/link";
import { notFound } from "next/navigation";
import CampaignRun from "@/components/manager/CampaignRun";
import { requirePermission } from "@/lib/auth";
import { getCampaign, progressFor } from "@/lib/campaigns";
import { campaignText } from "@/lib/campaign-text";
import { getCompanyName } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("marketing", "/manager/marketing");
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  const [progress, company] = await Promise.all([progressFor(id), getCompanyName()]);

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

      <CampaignRun
        id={campaign.id}
        status={campaign.status}
        initialProgress={progress}
        message={campaignText(company, campaign.body)}
      />
    </>
  );
}
