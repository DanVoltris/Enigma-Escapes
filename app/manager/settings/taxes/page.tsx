import PricingRules from "@/components/manager/PricingRules";
import TaxManager from "@/components/manager/TaxManager";
import { requirePermission } from "@/lib/auth";
import { getPricingMode } from "@/lib/pricing-settings";
import { activeTaxPercent, listTaxes } from "@/lib/taxes";

export const dynamic = "force-dynamic";

export default async function TaxesPage() {
  await requirePermission("settings", "/manager/settings/taxes");
  const [taxes, mode, taxPercent] = await Promise.all([listTaxes(), getPricingMode(), activeTaxPercent()]);
  return (
    <>
      <TaxManager taxes={taxes} />
      <PricingRules initial={mode} taxPercent={taxPercent} />
    </>
  );
}
