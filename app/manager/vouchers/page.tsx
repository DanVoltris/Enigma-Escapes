import BoardPage from "@/components/manager/BoardPage";
import VoucherProducts from "@/components/manager/VoucherProducts";
import { requirePermission } from "@/lib/auth";
import { listVoucherProducts } from "@/lib/voucher-products";
import { productStatsFromDb } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export default async function ManagerVouchers() {
  await requirePermission("promos", "/manager/vouchers");
  // Sales figures are grouped in the database — this page never loads the
  // individual codes, only the catalogue and a total per denomination.
  const [products, stats] = await Promise.all([listVoucherProducts(), productStatsFromDb()]);

  return (
    <>
      <BoardPage />
      <h1 className="mgr-page-title">Gift vouchers</h1>
      <p className="mgr-page-sub">
        The gift vouchers customers can buy on the site. Switch one off to take it off sale without losing its
        history. Individual codes — sold and given away — are under Promo codes.
      </p>
      <VoucherProducts products={products} stats={stats} />
    </>
  );
}
