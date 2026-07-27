import ApiKeysManager from "@/components/manager/ApiKeysManager";
import { listApiKeys } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

export default async function DevelopersPage() {
  const keys = await listApiKeys();
  return (
    <>
      <div className="mgr-card">
        <h2>Partner API keys</h2>
        <p className="card-sub">
          Keys let a channel partner (e.g. Morty) read your live availability. Each partner gets its own key so it
          can be revoked on its own. The feed exposes schedules, prices and booking links — never customer data.
        </p>
        <ApiKeysManager initialKeys={keys} />
      </div>

      <div className="mgr-card">
        <h2>Availability feed</h2>
        <p className="card-sub">What a partner calls with their key — live open slots for a date, grouped by experience:</p>
        <pre className="intg-code">{`GET /api/partner/availability?date=YYYY-MM-DD
Authorization: Bearer vb_...        (or append &key=vb_...)

curl -H "Authorization: Bearer vb_..." \\
  "https://your-site.example/api/partner/availability?date=2026-08-01"`}</pre>
        <p className="card-sub">
          Each slot includes a <code>bookUrl</code> that lands the player on the booking site with that room, date
          and time already selected. Dates outside the booking window are rejected, and sold-out slots report{" "}
          <code>remaining: 0</code>.
        </p>
      </div>
    </>
  );
}
