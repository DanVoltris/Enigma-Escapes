import IntegrationsForm from "@/components/manager/IntegrationsForm";
import { getIntegrations } from "@/lib/settings";
import { stripeMode, webhookConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const initial = await getIntegrations();
  return <IntegrationsForm initial={initial} stripe={{ mode: stripeMode(), webhook: webhookConfigured() }} />;
}
