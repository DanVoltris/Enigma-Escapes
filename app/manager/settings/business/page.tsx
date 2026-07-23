import BusinessDetailsForm from "@/components/manager/BusinessDetailsForm";
import { getBusinessDetails, SETTINGS_TABLE_SQL } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function BusinessDetailsPage() {
  const { tableMissing, value } = await getBusinessDetails();

  if (tableMissing) {
    return (
      <div className="mgr-card">
        <h2>One-time setup needed</h2>
        <p className="card-sub">
          Business details are stored in a <code>settings</code> table that doesn&apos;t exist yet, and creating tables
          needs the Supabase dashboard. Open the project&apos;s <strong>SQL editor</strong>, paste this, and run it —
          then reload this page:
        </p>
        <pre className="mgr-sql">{SETTINGS_TABLE_SQL}</pre>
        <p className="card-sub" style={{ marginTop: 12 }}>
          Row level security stays on with no policies, like every other table — only the server can touch it.
        </p>
      </div>
    );
  }

  return <BusinessDetailsForm initial={value} />;
}
