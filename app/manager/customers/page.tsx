import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import CustomerRow from "@/components/manager/CustomerRow";
import { aggregateCustomers, listManualCustomers } from "@/lib/customers";
import { listBookings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ManagerCustomers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sub?: string }>;
}) {
  await requirePermission("customers.view", "/manager/customers");
  const { q: rawQ, sub } = await searchParams;
  const q = (rawQ ?? "").trim().toLowerCase();
  const subscribersOnly = sub === "1";

  const [bookings, manual] = await Promise.all([listBookings(), listManualCustomers()]);
  let customers = await aggregateCustomers(bookings, manual);
  if (subscribersOnly) customers = customers.filter((c) => c.subscribed);
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
        <div className="mgr-actions-group">
          <Link href="/manager/customers/new" className="btn">
            + Add customer
          </Link>
        </div>
      </div>

      <div className="mgr-list-tools">
        <span>
          {customers.length} customer{customers.length === 1 ? "" : "s"}
          {subscribersOnly ? " subscribed to marketing" : ""}
        </span>
        <span>
          <Link href={subscribersOnly ? "/manager/customers" : "/manager/customers?sub=1"}>
            {subscribersOnly ? "Show everyone" : "Subscribers only"}
          </Link>
          {" · "}
          <a href={`/api/manager/customers/export${subscribersOnly ? "?subscribed=1" : ""}`}>Download CSV</a>
          {" · "}
          <Link href="/manager/customers/merge">Merge duplicates</Link>
        </span>
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
                <CustomerRow
                  key={c.email}
                  name={c.name}
                  email={c.email}
                  phone={c.phone}
                  bookings={c.bookings}
                  guests={c.guests}
                  spentCents={c.spentCents}
                  subscribed={c.subscribed}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
