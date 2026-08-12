import Link from "next/link";
import { formatMoney } from "@/lib/format";
import type { RewardCode } from "@/lib/reward-codes";
import type { Booking } from "@/lib/types";

// Supervisor view of the 20%-off codes: who earned one, whether it was spent,
// and — the point of the screen — which booking it was spent on, linked back
// to the booking that earned it. Server-rendered; there is one row per
// booking, so there is nothing to page through yet.
export default function RewardCodeList({
  rewards,
  bookings,
}: {
  rewards: RewardCode[];
  bookings: Map<string, Booking>;
}) {
  if (rewards.length === 0) {
    return <p className="mgr-empty">No reward codes have been issued yet.</p>;
  }

  const label = (id: string | null) => {
    if (!id) return null;
    const b = bookings.get(id);
    return b ? { ref: b.reference, name: `${b.customer.firstName} ${b.customer.lastName}`, id } : null;
  };

  const used = rewards.filter((r) => r.status === "used").length;
  const revoked = rewards.filter((r) => r.status === "revoked").length;
  const discounted = rewards.reduce((sum, r) => {
    const b = r.usedBooking ? bookings.get(r.usedBooking) : undefined;
    // A revoked code's discount was taken back off, so what it cost is
    // recorded separately; an active one still shows on the booking.
    return sum + (b ? b.pricing.discountCents || b.pricing.rewardOwedCents || 0 : 0);
  }, 0);

  return (
    <>
      <div className="vch-summary">
        <div>
          <span className="n">{rewards.length}</span>
          <span className="l">issued</span>
        </div>
        <div>
          <span className="n">{used}</span>
          <span className="l">redeemed</span>
        </div>
        <div>
          <span className="n">{revoked}</span>
          <span className="l">cancelled with their booking</span>
        </div>
        <div>
          <span className="n">{formatMoney(discounted)}</span>
          <span className="l">discount given</span>
        </div>
      </div>

      <div className="mgr-card">
        <div className="mgr-table-wrap">
          <table className="mgr-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Earned on</th>
                <th>Customer</th>
                <th>Spent on</th>
                <th className="num">Discount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rewards.map((r) => {
                const from = label(r.earnedBooking);
                const to = label(r.usedBooking);
                const spent = to ? bookings.get(to.id) : undefined;
                const amount = spent ? spent.pricing.discountCents || spent.pricing.rewardOwedCents || 0 : 0;
                return (
                  <tr key={r.code}>
                    <td>
                      <code>{r.code}</code>
                    </td>
                    <td>
                      {from ? (
                        <Link href={`/manager/bookings/${from.id}`}>{from.ref}</Link>
                      ) : (
                        <span className="sub">booking removed</span>
                      )}
                    </td>
                    <td>{from?.name ?? r.customerPhone}</td>
                    <td>
                      {to ? (
                        <Link href={`/manager/bookings/${to.id}`}>{to.ref}</Link>
                      ) : (
                        <span className="sub">—</span>
                      )}
                    </td>
                    <td className="num">{amount > 0 ? formatMoney(amount) : "—"}</td>
                    <td>
                      {r.status === "used" ? (
                        <span className="mgr-pill on">Redeemed</span>
                      ) : r.status === "revoked" ? (
                        <span className="mgr-pill off">Cancelled</span>
                      ) : (
                        <span className="mgr-pill">Unused</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
