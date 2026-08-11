"use client";

import Link from "next/link";
import { itemKey, useCart } from "@/lib/cart";
import { formatDateLong, formatMoney, formatTime } from "@/lib/format";
import { cardDueCents, computeTotals, voucherAppliedCents } from "@/lib/pricing";
import RoomBadge from "./RoomBadge";

export default function CartSummary({
  editable = true,
  showCustomer = false,
}: {
  editable?: boolean;
  showCustomer?: boolean;
}) {
  const { items, customer, promo, voucher, paymentOption, taxPercent, pricingMode, taxLabel, removeItem } = useCart();
  const totals = computeTotals(items, promo?.percentOff ?? 0, taxPercent, pricingMode);
  // The voucher is money already paid, so it lands after tax and pays the
  // deposit first — the same arithmetic the server does at booking time.
  const voucherCents = voucher ? voucherAppliedCents(totals, voucher.remainingCents) : 0;
  const dueNow = cardDueCents(totals, paymentOption, voucherCents);

  return (
    <aside className="summary">
      <Link href="/" className="summary-add">
        + Add another booking
      </Link>
      <div className="summary-body">
        {showCustomer && customer && (
          <>
            <h3 className="summary-heading">Your information</h3>
            <div className="summary-customer">
              <div className="name">
                {customer.firstName} {customer.lastName}
              </div>
              <div className="email">{customer.email}</div>
              <Link href="/checkout">Edit information</Link>
            </div>
          </>
        )}

        <h3 className="summary-heading">Your bookings</h3>
        {items.length === 0 && <p className="summary-empty">No bookings yet. Add one to get started.</p>}
        {items.map((item) => (
          <div className="summary-item" key={itemKey(item)}>
            <RoomBadge name={item.roomName} bg={item.badgeBg} fg={item.badgeFg} />
            <div className="summary-item-info">
              <div className="name">{item.roomName}</div>
              <div className="meta">
                {formatDateLong(item.date)} — {formatTime(item.time)}
              </div>
              <div className="meta">
                {item.quantity} × {formatMoney(item.priceCents)} = {formatMoney(item.quantity * item.priceCents)}
              </div>
              {editable && (
                <div className="summary-item-actions">
                  <Link href={`/?date=${item.date}&slot=${item.roomId}|${item.time}`}>Edit booking</Link>
                  <button type="button" className="link-button danger" onClick={() => removeItem(itemKey(item))}>
                    Remove booking
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {items.length > 0 && (
          <div className="summary-totals">
            <div className="summary-line">
              <span>Subtotal</span>
              <span>{formatMoney(totals.subtotalCents)}</span>
            </div>
            {totals.discountCents > 0 && (
              <div className="summary-line discount">
                <span>Promo ({promo?.code})</span>
                <span>-{formatMoney(totals.discountCents)}</span>
              </div>
            )}
            <div className="summary-line">
              <span>
                {taxLabel} ({taxPercent}%)
              </span>
              <span>{formatMoney(totals.gstCents)}</span>
            </div>
            <div className="summary-line total">
              <span>Total</span>
              <span>{formatMoney(totals.totalCents)}</span>
            </div>
            {voucherCents > 0 && (
              <div className="summary-line">
                <span>Gift voucher ({voucher?.code})</span>
                <span>-{formatMoney(voucherCents)}</span>
              </div>
            )}
            <div className="summary-line due">
              <span>Amount due now</span>
              <span>{formatMoney(dueNow)}</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
