import Link from "next/link";
import CampaignComposer from "@/components/manager/CampaignComposer";
import { requirePermission } from "@/lib/auth";
import { listCampaigns, progressForAll } from "@/lib/campaigns";
import { formatTimestamp } from "@/lib/format";
import { listAllLocations } from "@/lib/hours";
import { getCompanyName } from "@/lib/settings";
import { smsConfigured } from "@/lib/sms";
import { getSmsRateCents, TEXTS_PER_MINUTE } from "@/lib/sms-rate";
import { areaCodeCounts } from "@/lib/campaign-stats";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const staff = await requirePermission("marketing", "/manager/marketing");
  const [company, locations, areaCodes, campaigns, rateCents] = await Promise.all([
    getCompanyName(),
    listAllLocations(),
    areaCodeCounts().catch(() => []),
    listCampaigns().catch(() => []),
    getSmsRateCents(),
  ]);
  const byId = await progressForAll().catch(() => new Map());

  return (
    <>
      <h1 className="mgr-page-title">Marketing</h1>
      <p className="mgr-page-sub">Text your customers — an offer, a new room, a Halloween night.</p>

      <CampaignComposer
        company={company}
        locations={locations}
        areaCodes={areaCodes}
        myPhone={staff.phone}
        smsReady={smsConfigured()}
        rateCents={rateCents}
        textsPerMinute={TEXTS_PER_MINUTE}
      />

      <div className="mgr-card">
        <h2>Campaigns</h2>
        {campaigns.length === 0 ? (
          <p className="cust-empty">Nothing sent yet.</p>
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const p = byId.get(c.id);
                  return (
                    <tr key={c.id}>
                      <td>
                        {c.name}
                        <span className="sub"> — {c.body.slice(0, 60)}{c.body.length > 60 ? "…" : ""}</span>
                      </td>
                      <td>
                        {formatTimestamp(c.createdAt)}
                        {c.createdBy && <span className="sub"> by {c.createdBy}</span>}
                      </td>
                      <td>
                        <span className={`mgr-pill${c.status === "sending" ? " on" : ""}`}>
                          {c.status === "draft"
                            ? "Not started"
                            : c.status === "sending"
                              ? "Sending"
                              : c.status === "paused"
                                ? "Paused"
                                : "Finished"}
                        </span>
                      </td>
                      <td>
                        {p ? `${p.sent.toLocaleString()} of ${p.total.toLocaleString()}` : "—"}
                        {p && p.failed > 0 && <span className="sub"> · {p.failed} failed</span>}
                        {p && p.unsubscribed > 0 && (
                          <span className="sub"> · {p.unsubscribed.toLocaleString()} unsubscribed</span>
                        )}
                      </td>
                      <td>
                        <Link href={`/manager/marketing/${c.id}`}>Open</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
