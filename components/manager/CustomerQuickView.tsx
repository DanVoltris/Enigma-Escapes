"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { ImportedHistory } from "@/lib/customers";
import { formatDateLong, formatMoney } from "@/lib/format";

export type QuickViewCustomer = {
  name: string;
  email: string;
  phone: string;
  subscribed: boolean;
  bookings: number;
  guests: number;
  spentCents: number;
  imported: ImportedHistory | null;
};

const n = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// "2026-08-01" from the old export — anything else is shown as-is rather than
// risking a wrong date from a format we haven't seen.
function legacyDate(v: string | null | undefined): string | null {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDateLong(v) : v;
}

// Summary card for a customer, opened from their name on the Customers tab.
// Escape or a click outside closes it; the full profile is one click away.
export default function CustomerQuickView({
  customer,
  onClose,
}: {
  customer: QuickViewCustomer;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const imp = customer.imported;
  // Figures the old system recorded but this one has no equivalent for.
  const owing = n(imp?.unpaidCents);
  const credit = n(imp?.creditRemainingCents);
  const vouchers = n(imp?.vouchers);

  return (
    <div
      className="confirm-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cust-quick" role="dialog" aria-modal="true" aria-label={customer.name}>
        <div className="cust-quick-head">
          <h3>{customer.name}</h3>
          <button type="button" ref={closeRef} className="cust-quick-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="cust-quick-contact">
          <a href={`mailto:${customer.email}`}>{customer.email}</a>
          {customer.phone && <a href={`tel:${customer.phone}`}>{customer.phone}</a>}
          {imp?.altPhone && <span className="muted">{imp.altPhone} (second number)</span>}
          <span className={`mgr-pill${customer.subscribed ? " on" : ""}`}>
            {customer.subscribed ? "Subscribed" : "Not subscribed"}
          </span>
        </div>

        <dl className="cust-quick-stats">
          <div>
            <dt>Bookings</dt>
            <dd>{customer.bookings}</dd>
          </div>
          <div>
            <dt>Guests brought</dt>
            <dd>{customer.guests || "—"}</dd>
          </div>
          <div>
            <dt>Paid to date</dt>
            <dd>{formatMoney(customer.spentCents)}</dd>
          </div>
        </dl>

        {imp && (
          <div className="cust-quick-legacy">
            <h4>From the previous booking system</h4>
            <dl>
              <div>
                <dt>Bookings</dt>
                <dd>{n(imp.bookings)}</dd>
              </div>
              <div>
                <dt>Booked value</dt>
                <dd>{formatMoney(n(imp.bookingValueCents))}</dd>
              </div>
              <div>
                <dt>Paid</dt>
                <dd>{formatMoney(n(imp.paidCents))}</dd>
              </div>
              {owing > 0 && (
                <div>
                  <dt>Still owing</dt>
                  <dd className="due">{formatMoney(owing)}</dd>
                </div>
              )}
              {credit > 0 && (
                <div>
                  <dt>Credit left</dt>
                  <dd>{formatMoney(credit)}</dd>
                </div>
              )}
              {vouchers > 0 && (
                <div>
                  <dt>Gift vouchers</dt>
                  <dd>
                    {vouchers} · {formatMoney(n(imp.voucherValueCents))}
                  </dd>
                </div>
              )}
            </dl>
            <ul className="cust-quick-facts">
              {imp.joinedAt && (
                <li>
                  <span>Joined</span>
                  {imp.joinedAt}
                </li>
              )}
              {imp.lastAttended && (
                <li>
                  <span>Last played</span>
                  {legacyDate(imp.lastAttended)}
                </li>
              )}
              {imp.lastItem && (
                <li>
                  <span>Last room</span>
                  {imp.lastItem}
                </li>
              )}
              {imp.dob && (
                <li>
                  <span>Date of birth</span>
                  {imp.dob}
                </li>
              )}
              {imp.waiver && (
                <li>
                  <span>Waiver</span>
                  {imp.waiver}
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="cust-quick-actions">
          <a href={`mailto:${customer.email}`} className="btn btn-outline">
            Email
          </a>
          <Link href={`/manager/customers/${encodeURIComponent(customer.email)}`} className="btn">
            View full profile
          </Link>
        </div>
      </div>
    </div>
  );
}
