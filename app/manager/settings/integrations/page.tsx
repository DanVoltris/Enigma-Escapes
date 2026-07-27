import IntegrationsForm from "@/components/manager/IntegrationsForm";
import { listApiKeys } from "@/lib/api-keys";
import { getIntegrations } from "@/lib/settings";
import { smsConfigured } from "@/lib/sms";
import { stripeMode, webhookConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const [initial, apiKeys] = await Promise.all([getIntegrations(), listApiKeys()]);
  return (
    <IntegrationsForm
      initial={initial}
      stripe={{ mode: stripeMode(), webhook: webhookConfigured() }}
      sms={smsConfigured()}
      apiKeys={apiKeys}
    />
  );
}
