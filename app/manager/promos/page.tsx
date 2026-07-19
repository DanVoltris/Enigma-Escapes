import PromoManager from "@/components/manager/PromoManager";
import { listPromos } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ManagerPromos() {
  const promos = await listPromos();

  return (
    <>
      <h1 className="mgr-page-title">Promo codes</h1>
      <p className="mgr-page-sub">Percentage discounts customers can apply at checkout.</p>
      <PromoManager promos={promos} />
    </>
  );
}
