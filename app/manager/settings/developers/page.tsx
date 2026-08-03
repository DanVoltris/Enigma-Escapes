import Link from "next/link";
import { requirePermission } from "@/lib/auth";

export default async function DevelopersPage() {
  await requirePermission("settings", "/manager/settings/developers");
  return (
    <div className="mgr-card">
      <h2>API keys</h2>
      <p className="mgr-empty">
        Partner API keys (and the availability feed they unlock) are managed with the rest of the integrations on{" "}
        <Link href="/manager/settings/integrations">Settings → Marketing &amp; tracking</Link>. There is no other
        public API; the only remaining credential is the Supabase service key, which lives server-side in
        environment variables and is never exposed to the browser.
      </p>
    </div>
  );
}
