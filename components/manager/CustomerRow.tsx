"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CustomerQuickView, { type QuickViewCustomer } from "./CustomerQuickView";
import type { ImportedHistory } from "@/lib/customers";
import { formatMoney } from "@/lib/format";

type Props = {
  name: string;
  email: string;
  phone: string;
  bookings: number;
  guests: number;
  spentCents: number;
  subscribed: boolean;
  imported: ImportedHistory | null;
};

// Clicking the name opens a summary popup; clicking anywhere else in the row
// still goes straight to the full profile.
export default function CustomerRow(props: Props) {
  const { name, email, phone, bookings, guests, spentCents, subscribed, imported } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const href = `/manager/customers/${encodeURIComponent(email)}`;

  const quickView: QuickViewCustomer = { name, email, phone, subscribed, bookings, guests, spentCents, imported };

  return (
    <>
      <tr onClick={() => router.push(href)} style={{ cursor: "pointer" }}>
        <td>
          <button
            type="button"
            className="cust-name-btn"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
          >
            {name}
          </button>
          {imported && <span className="cust-imported-tag">imported</span>}
        </td>
        <td>
          {email}
          <br />
          <span style={{ color: "var(--text-secondary)" }}>{phone}</span>
        </td>
        <td className="num">{bookings}</td>
        <td className="num">{guests}</td>
        <td className="num">{formatMoney(spentCents)}</td>
        <td>
          <span className={`mgr-pill${subscribed ? " on" : ""}`}>
            {subscribed ? "Subscribed" : "Not subscribed"}
          </span>
        </td>
      </tr>
      {open && <CustomerQuickView customer={quickView} onClose={() => setOpen(false)} />}
    </>
  );
}
