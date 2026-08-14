import Link from "next/link";
import { allowedLocations, requirePermission } from "@/lib/auth";
import CustomerRow from "@/components/manager/CustomerRow";
import { aggregateCustomers, importedHistoryFor, listManualCustomers } from "@/lib/customers";
import { listBookings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ManagerCustomers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sub?: string; page?: string }>;
}) {
  const staff = await requirePermission("customers.view", "/manager/customers");
  const scope = allowedLocations(staff);
  const { q: rawQ, sub, page: rawPage } = await searchParams;
  const q = (rawQ ?? "").trim().toLowerCase();
  const subscribersOnly = sub === "1";

  // The roster is fetched without the imported-history blob — it is only needed
  // for the rows actually rendered, and carrying it for all 44k people is what
  // made this page take 21 seconds to build.
  const [allBookings, manual] = await Promise.all([
    listBookings(),
    listManualCustomers({ history: false }),
  ]);
  const bookings = scope ? allBookings.filter((b) => b.items.some((i) => scope.includes(i.location))) : allBookings;
  let customers = await aggregateCustomers(bookings, manual);
  if (subscribersOnly) customers = customers.filter((c) => c.subscribed);
  if (q) {
    customers = customers.filter((c) =>
      `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q)
    );
  }

  // Only one screenful is rendered. Since the old system's customers were
  // imported the roster is tens of thousands of people, and putting every one
  // of them in the HTML made this page too large to load at all.
  const PER_PAGE = 100;
  const pageCount = Math.max(1, Math.ceil(customers.length / PER_PAGE));
  const current = Math.min(Math.max(1, Math.floor(Number(rawPage)) || 1), pageCount);
  const page = customers.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  // Now that we know which hundred are on screen, fetch their real history.
  const history = await importedHistoryFor(page.filter((c) => c.imported).map((c) => c.email));
  const shown = page.map((c) =>
    c.imported ? { ...c, imported: history.get(c.email.toLowerCase()) ?? c.imported } : c
  );
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    if (rawQ) params.set("q", rawQ);
    if (subscribersOnly) params.set("sub", "1");
    if (n > 1) params.set("page", String(n));
    const qs = params.toString();
    return `/manager/customers${qs ? `?${qs}` : ""}`;
  };

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
          {customers.length.toLocaleString()} customer{customers.length === 1 ? "" : "s"}
          {subscribersOnly ? " subscribed to marketing" : ""}
          {pageCount > 1
            ? ` · showing ${((current - 1) * PER_PAGE + 1).toLocaleString()}–${Math.min(
                current * PER_PAGE,
                customers.length
              ).toLocaleString()}`
            : ""}
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
              {shown.map((c) => (
                <CustomerRow
                  key={c.email}
                  name={c.name}
                  email={c.email}
                  phone={c.phone}
                  bookings={c.bookings}
                  guests={c.guests}
                  spentCents={c.spentCents}
                  subscribed={c.subscribed}
                  imported={c.imported}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="mgr-list-tools">
          <span>
            Page {current.toLocaleString()} of {pageCount.toLocaleString()}
          </span>
          <span>
            {current > 1 ? (
              <Link href={pageHref(current - 1)}>← Previous</Link>
            ) : (
              <span className="sub">← Previous</span>
            )}
            {" · "}
            {current < pageCount ? (
              <Link href={pageHref(current + 1)}>Next →</Link>
            ) : (
              <span className="sub">Next →</span>
            )}
          </span>
        </div>
      )}
    </>
  );
}
