import NewStaffCode from "@/components/manager/NewStaffCode";
import PromoManager from "@/components/manager/PromoManager";
import VoucherManager from "@/components/manager/VoucherManager";
import { requirePermission } from "@/lib/auth";
import { listPromos } from "@/lib/db";
import { listVouchers } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export default async function ManagerPromos() {
  await requirePermission("promos", "/manager/promos");
  const [promos, allVouchers] = await Promise.all([listPromos(), listVouchers()]);
  // Staff-created giveaway codes — dollar balances handed out for marketing,
  // apologies and events. They redeem like gift vouchers (their balances are
  // real money the business owes), but this is where the team looks for them.
  const staffCodes = allVouchers.filter((v) => v.kind === "comp");

  return (
    <>
      <h1 className="mgr-page-title">Promo codes</h1>
      <p className="mgr-page-sub">Percentage discounts customers can apply at checkout.</p>
      <PromoManager promos={promos} />

      <h2 className="mgr-page-title" style={{ marginTop: 34 }}>
        Staff-issued codes
      </h2>
      <p className="mgr-page-sub">
        Dollar-value codes created by the team — giveaways, apologies, event prizes. Each carries a balance and is
        redeemed like a gift voucher; click a code to set its rules.
      </p>
      <NewStaffCode />
      <VoucherManager vouchers={staffCodes} />
    </>
  );
}
