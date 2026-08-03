import TaxManager from "@/components/manager/TaxManager";
import { requirePermission } from "@/lib/auth";
import { listTaxes } from "@/lib/taxes";

export const dynamic = "force-dynamic";

export default async function TaxesPage() {
  await requirePermission("settings", "/manager/settings/taxes");
  const taxes = await listTaxes();
  return <TaxManager taxes={taxes} />;
}
