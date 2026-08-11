import VoucherProducts from "@/components/manager/VoucherProducts";
import { requirePermission } from "@/lib/auth";
import { listVoucherProducts, statsFor } from "@/lib/voucher-products";
import { listVouchers } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export default async function ManagerVouchers() {
  await requirePermission("promos", "/manager/vouchers");
  // The catalogue, plus how each product has actually sold. Individual codes
  // live on Promo codes — this tab is only about what's available to buy.
  const [products, vouchers] = await Promise.all([listVoucherProducts(), listVouchers()]);
  const stats = Object.fromEntries(statsFor(products, vouchers));

  return (
    <>
      <h1 className="mgr-page-title">Gift vouchers</h1>
      <p className="mgr-page-sub">
        The gift vouchers customers can buy on the site. Switch one off to take it off sale without losing its
        history. Individual codes — sold and given away — are under Promo codes.
      </p>
      <VoucherProducts products={products} stats={stats} />
    </>
  );
}
