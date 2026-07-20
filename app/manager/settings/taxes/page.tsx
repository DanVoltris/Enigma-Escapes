import TaxManager from "@/components/manager/TaxManager";
import { listTaxes } from "@/lib/taxes";

export const dynamic = "force-dynamic";

export default async function TaxesPage() {
  const taxes = await listTaxes();
  return <TaxManager taxes={taxes} />;
}
