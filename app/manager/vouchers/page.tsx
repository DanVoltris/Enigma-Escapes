import VoucherManager from "@/components/manager/VoucherManager";
import { requirePermission } from "@/lib/auth";
import { listVouchers } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export default async function ManagerVouchers() {
  await requirePermission("promos", "/manager/vouchers");
  // Customer-purchased vouchers only — staff-issued giveaway codes live on
  // the Promo codes tab, where the team goes looking for them.
  const vouchers = (await listVouchers()).filter((v) => v.kind === "purchased");

  return (
    <>
      <h1 className="mgr-page-title">Gift vouchers</h1>
      <p className="mgr-page-sub">
        Vouchers customers paid for — bought on this site or in the old system. Each is a prepaid balance that can be
        spent across several visits. Staff-issued codes are under Promo codes.
      </p>
      <VoucherManager vouchers={vouchers} />
    </>
  );
}
