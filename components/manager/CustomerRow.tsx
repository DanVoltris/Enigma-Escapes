"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/format";

type Props = {
  name: string;
  email: string;
  phone: string;
  bookings: number;
  guests: number;
  spentCents: number;
  subscribed: boolean;
};

// Whole-row link to the customer's profile. The name stays a real <Link> so
// keyboard users can focus it and "open in new tab" still works; clicking
// anywhere else in the row navigates via the router.
export default function CustomerRow({ name, email, phone, bookings, guests, spentCents, subscribed }: Props) {
  const router = useRouter();
  const href = `/manager/customers/${encodeURIComponent(email)}`;

  return (
    <tr onClick={() => router.push(href)} style={{ cursor: "pointer" }}>
      <td>
        <Link href={href} onClick={(e) => e.stopPropagation()}>
          {name}
        </Link>
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
  );
}
