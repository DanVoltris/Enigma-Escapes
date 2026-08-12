import NewStaffCode from "@/components/manager/NewStaffCode";
import RewardCodeList from "@/components/manager/RewardCodeList";
import PromoManager from "@/components/manager/PromoManager";
import VoucherManager from "@/components/manager/VoucherManager";
import { requirePermission } from "@/lib/auth";
import { getBookingsByIds, listPromos } from "@/lib/db";
import { listRewardCodes } from "@/lib/reward-codes";
import { listVoucherPage, voucherTotalsFromDb } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export default async function ManagerPromos() {
  await requirePermission("promos", "/manager/promos");
  // Only the first page of codes travels with the HTML; searching and paging
  // go back to the database. There are a couple of thousand of these.
  const [promos, page, totals, rewards] = await Promise.all([
    listPromos(),
    listVoucherPage({ limit: 60 }),
    voucherTotalsFromDb(),
    listRewardCodes(),
  ]);
  // Both ends of every reward in one query, so each row can link the booking
  // that earned it to the booking that spent it.
  const rewardBookings = await getBookingsByIds(
    rewards.flatMap((r) => [r.earnedBooking, ...(r.usedBooking ? [r.usedBooking] : [])])
  );

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

      <h2 className="mgr-page-title" style={{ marginTop: 34 }}>
        Reward codes
      </h2>
      <p className="mgr-page-sub">
        The 20% off texted to every customer when they book, for their next visit. Each one is tied to the booking
        that earned it — cancel that booking and the discount is taken back off whatever it was spent on.
      </p>
      <RewardCodeList rewards={rewards} bookings={rewardBookings} />
    </>
  );
}
