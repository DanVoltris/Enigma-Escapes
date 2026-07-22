"use client";

import { useState } from "react";
import Link from "next/link";
import RoomBadge from "@/components/RoomBadge";
import { formatMoney } from "@/lib/format";

export type Purchase = {
  bookingId: string;
  reference: string;
  roomName: string;
  imageUrl: string | null;
  badgeBg: string;
  badgeFg: string;
  when: string;
  duration: string;
  quantity: number;
  amountCents: number;
};
export type Payment = {
  bookingId: string;
  reference: string;
  method: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
};
export type Tax = {
  bookingId: string;
  reference: string;
  subtotalCents: number;
  gstCents: number;
};
export type Promo = { bookingId: string; reference: string; code: string };

type Props = {
  purchases: Purchase[];
  payments: Payment[];
  taxes: Tax[];
  promos: Promo[];
};

type TabKey = "purchases" | "promos" | "taxes" | "payments" | "questions";

export default function CustomerTabs({ purchases, payments, taxes, promos }: Props) {
  const [tab, setTab] = useState<TabKey>("purchases");

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "purchases", label: "All Purchases", count: purchases.length },
    { key: "promos", label: "Promos/Gifts", count: promos.length },
    { key: "taxes", label: "Taxes/Fees", count: taxes.length },
    { key: "payments", label: "Payments", count: payments.length },
    { key: "questions", label: "Questions", count: 0 },
  ];

  return (
    <>
      <div className="cust-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`cust-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="n">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="cust-tabpanel">
        {tab === "purchases" &&
          (purchases.length === 0 ? (
            <p className="cust-empty">No purchases on file.</p>
          ) : (
            purchases.map((p, i) => (
              <div className="cust-purchase" key={`${p.bookingId}-${i}`}>
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="cust-thumb" src={p.imageUrl} alt="" />
                ) : (
                  <RoomBadge name={p.roomName} bg={p.badgeBg} fg={p.badgeFg} />
                )}
                <div className="cust-purchase-main">
                  <Link href={`/manager/bookings/${p.bookingId}`} className="cust-purchase-name">
                    {p.roomName}
                  </Link>
                  <div className="cust-purchase-sub">
                    {p.when} · {p.duration} · Booking {p.reference}
                  </div>
                </div>
                <div className="cust-purchase-qty">
                  <span className="k">Quantity</span>×{p.quantity}
                </div>
                <div className="cust-purchase-amt">
                  <span className="k">Amount</span>
                  {formatMoney(p.amountCents)}
                </div>
              </div>
            ))
          ))}

        {tab === "promos" &&
          (promos.length === 0 ? (
            <p className="cust-empty">No promo codes or gift cards used.</p>
          ) : (
            <div className="mgr-table-wrap">
              <table className="mgr-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Booking</th>
                  </tr>
                </thead>
                <tbody>
                  {promos.map((p, i) => (
                    <tr key={i}>
                      <td>
                        <span className="mgr-pill">{p.code}</span>
                      </td>
                      <td>
                        <Link href={`/manager/bookings/${p.bookingId}`}>{p.reference}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {tab === "taxes" &&
          (taxes.length === 0 ? (
            <p className="cust-empty">No taxes or fees on file.</p>
          ) : (
            <div className="mgr-table-wrap">
              <table className="mgr-table">
                <thead>
                  <tr>
                    <th>Booking</th>
                    <th className="num">Subtotal</th>
                    <th className="num">Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {taxes.map((t, i) => (
                    <tr key={i}>
                      <td>
                        <Link href={`/manager/bookings/${t.bookingId}`}>{t.reference}</Link>
                      </td>
                      <td className="num">{formatMoney(t.subtotalCents)}</td>
                      <td className="num">{formatMoney(t.gstCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {tab === "payments" &&
          (payments.length === 0 ? (
            <p className="cust-empty">No payments on file.</p>
          ) : (
            <div className="mgr-table-wrap">
              <table className="mgr-table">
                <thead>
                  <tr>
                    <th>Booking</th>
                    <th>Method</th>
                    <th className="num">Total</th>
                    <th className="num">Paid</th>
                    <th className="num">Balance due</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, i) => (
                    <tr key={i}>
                      <td>
                        <Link href={`/manager/bookings/${p.bookingId}`}>{p.reference}</Link>
                      </td>
                      <td>{p.method}</td>
                      <td className="num">{formatMoney(p.totalCents)}</td>
                      <td className="num">{formatMoney(p.paidCents)}</td>
                      <td className="num">
                        {p.balanceCents > 0 ? (
                          <strong style={{ color: "var(--danger)" }}>{formatMoney(p.balanceCents)}</strong>
                        ) : (
                          "Paid in full"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {tab === "questions" && <p className="cust-empty">No questions on file.</p>}
      </div>
    </>
  );
}
