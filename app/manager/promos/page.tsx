import NewStaffCode from "@/components/manager/NewStaffCode";
import PromoManager from "@/components/manager/PromoManager";
import VoucherManager from "@/components/manager/VoucherManager";
import { requirePermission } from "@/lib/auth";
import { listPromos } from "@/lib/db";
import { listVouchers } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export default async function ManagerPromos() {
  await requirePermission("promos", "/manager/promos");
  // Every code that has been issued — bought by a customer or handed out by
  // staff. Both carry a dollar balance and redeem the same way, so they belong
  // in one list. The Gift vouchers tab manages what's on sale, not these.
  const [promos, codes] = await Promise.all([listPromos(), listVouchers()]);

  return (
    <>
      <h1 className="mgr-page-title">Promo codes</h1>
      <p className="mgr-page-sub">Percentage discounts customers can apply at checkout.</p>
      <PromoManager promos={promos} />

      <h2 className="mgr-page-title" style={{ marginTop: 34 }}>
        Voucher codes
      </h2>
      <p className="mgr-page-sub">
        Every code in circulation — bought by customers or given out by the team. Each carries a balance; click one to
        see its rules or redeem against it.
      </p>
      <NewStaffCode />
      <VoucherManager vouchers={codes} />
    </>
  );
}
