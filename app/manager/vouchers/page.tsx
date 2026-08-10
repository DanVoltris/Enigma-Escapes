import VoucherManager from "@/components/manager/VoucherManager";
import { requirePermission } from "@/lib/auth";
import { listVouchers } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export default async function ManagerVouchers() {
  await requirePermission("promos", "/manager/vouchers");
  const vouchers = await listVouchers();

  return (
    <>
      <h1 className="mgr-page-title">Gift vouchers</h1>
      <p className="mgr-page-sub">
        Prepaid balances imported from the old system. Unlike promo codes (a percentage off), each voucher is worth a
        fixed amount and can be spent across several visits.
      </p>
      <VoucherManager vouchers={vouchers} />
    </>
  );
}
