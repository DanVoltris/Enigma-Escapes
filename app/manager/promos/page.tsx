import PromoManager from "@/components/manager/PromoManager";
import { requirePermission } from "@/lib/auth";
import { listPromos } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ManagerPromos() {
  await requirePermission("promos", "/manager/promos");
  const promos = await listPromos();

  return (
    <>
      <h1 className="mgr-page-title">Promo codes</h1>
      <p className="mgr-page-sub">Percentage discounts customers can apply at checkout.</p>
      <PromoManager promos={promos} />
    </>
  );
}
