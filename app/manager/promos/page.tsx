import NewStaffCode from "@/components/manager/NewStaffCode";
import PromoManager from "@/components/manager/PromoManager";
import VoucherManager from "@/components/manager/VoucherManager";
import { requirePermission } from "@/lib/auth";
import { listPromos } from "@/lib/db";
import { listVoucherPage, voucherTotalsFromDb } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export default async function ManagerPromos() {
  await requirePermission("promos", "/manager/promos");
  // Only the first page of codes travels with the HTML; searching and paging
  // go back to the database. There are a couple of thousand of these.
  const [promos, page, totals] = await Promise.all([listPromos(), listVoucherPage({ limit: 60 }), voucherTotalsFromDb()]);

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
      <VoucherManager initialRows={page.rows} initialTotal={page.total} totals={totals} />
    </>
  );
}
