import Link from "next/link";
import { listBookings } from "@/lib/db";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

type CustomerRow = {
  name: string;
  email: string;
  phone: string;
  subscribed: boolean;
  bookings: number;
  guests: number;
  spentCents: number;
  lastBooked: string; // ISO timestamp of most recent booking
};

export default async function ManagerCustomers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: rawQ } = await searchParams;
  const q = (rawQ ?? "").trim().toLowerCase();

  const bookings = await listBookings();
  const byEmail = new Map<string, CustomerRow>();
  for (const b of bookings) {
    const key = b.customer.email.toLowerCase();
    const row = byEmail.get(key) ?? {
      name: `${b.customer.firstName} ${b.customer.lastName}`,
      email: b.customer.email,
      phone: b.customer.phone,
      subscribed: b.customer.subscribe,
      bookings: 0,
      guests: 0,
      spentCents: 0,
      lastBooked: b.createdAt,
    };
    row.bookings += 1;
    row.guests += b.items.reduce((s, i) => s + i.quantity, 0);
    row.spentCents += b.pricing.paidCents;
    if (b.createdAt > row.lastBooked) {
      row.lastBooked = b.createdAt;
      row.name = `${b.customer.firstName} ${b.customer.lastName}`;
      row.phone = b.customer.phone;
      row.subscribed = b.customer.subscribe;
    }
    byEmail.set(key, row);
  }

  let customers = Array.from(byEmail.values()).sort((a, b) => b.lastBooked.localeCompare(a.lastBooked));
  if (q) {
    customers = customers.filter((c) =>
      `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q)
    );
  }

  return (
    <>
      <h1 className="mgr-page-title">Customers</h1>
      <p className="mgr-page-sub">
        Everyone who has booked with you, grouped by email address. Most recent first.
      </p>

      <div className="mgr-actions-row">
        <form action="/manager/customers" method="get" className="mgr-inline-form">
          <div className="field">
            <label htmlFor="q">Search</label>
            <input type="text" id="q" name="q" defaultValue={rawQ ?? ""} placeholder="Name, email or phone" style={{ minWidth: 280 }} />
          </div>
          <button type="submit" className="btn">
            Search
          </button>
          {q && (
            <Link href="/manager/customers" className="btn btn-outline">
              Clear
            </Link>
          )}
        </form>
      </div>

      {customers.length === 0 ? (
        <p className="mgr-empty">No customers found{q ? ` for “${rawQ}”` : " yet — they’ll appear here after their first booking"}.</p>
      ) : (
        <div className="mgr-table-wrap">
          <table className="mgr-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th className="num">Bookings</th>
                <th className="num">Guests brought</th>
                <th className="num">Paid to date</th>
                <th>Marketing</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.email}>
                  <td>
                    <Link href={`/manager/bookings?scope=all&q=${encodeURIComponent(c.email)}`}>{c.name}</Link>
                  </td>
                  <td>
                    {c.email}
                    <br />
                    <span style={{ color: "var(--text-secondary)" }}>{c.phone}</span>
                  </td>
                  <td className="num">{c.bookings}</td>
                  <td className="num">{c.guests}</td>
                  <td className="num">{formatMoney(c.spentCents)}</td>
                  <td>
                    <span className={`mgr-pill${c.subscribed ? " on" : ""}`}>
                      {c.subscribed ? "Subscribed" : "Not subscribed"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
