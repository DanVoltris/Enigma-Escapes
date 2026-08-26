import Link from "next/link";
import BoardPage from "@/components/manager/BoardPage";
import BookingsSubnav from "@/components/manager/BookingsSubnav";
import SendInvoice from "@/components/manager/SendInvoice";
import { requirePermission } from "@/lib/auth";
import { emailConfigured } from "@/lib/email";
import { formatDateLong, formatMoney } from "@/lib/format";
import { isExpired, listQuotes, quoteTotals } from "@/lib/quotes";

export const dynamic = "force-dynamic";

export default async function ManagerInvoices() {
  await requirePermission("bookings.view", "/manager/invoices");
  const quotes = await listQuotes().catch(() => []);
  const ready = emailConfigured();

  return (
    <>
      <BoardPage />
      <div className="mgr-actions-row">
        <div>
          <h1 className="mgr-page-title">Invoices</h1>
          <p style={{ color: "var(--text-secondary)" }}>
            Bill a customer before they book — a corporate group that needs an invoice to get payment
            approved. An invoice holds no session; the booking is made once they pay.
          </p>
        </div>
        <Link href="/manager/invoices/new" className="btn">
          + New invoice
        </Link>
      </div>

      <BookingsSubnav />

      {!ready && (
        <p className="mgr-page-sub" style={{ marginTop: 14 }}>
          Email isn&apos;t switched on yet, so invoices can be raised but not sent. Add{" "}
          <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> to the environment and redeploy.
        </p>
      )}

      <div className="mgr-card" style={{ marginTop: 18 }}>
        <h2>
          {quotes.length.toLocaleString()} invoice{quotes.length === 1 ? "" : "s"}
        </h2>
        {quotes.length === 0 ? (
          <p className="mgr-empty">
            No invoices yet. <Link href="/manager/invoices/new">Raise the first one</Link>.
          </p>
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Raised</th>
                  <th>Status</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => {
                  const totals = quoteTotals(q);
                  return (
                    <tr key={q.id}>
                      <td>
                        <a href={`/invoice/${q.token}`} target="_blank" rel="noreferrer">
                          {q.number}
                        </a>
                      </td>
                      <td>
                        {q.customer.company || q.customer.name}
                        <div className="sub">{q.customer.email}</div>
                      </td>
                      <td>{formatDateLong(q.createdAt.slice(0, 10))}</td>
                      <td>
                        {q.status === "void" ? (
                          <span className="mgr-pill">Void</span>
                        ) : q.status === "sent" ? (
                          <span className="mgr-pill">
                            Sent{q.sentAt ? ` ${formatDateLong(q.sentAt.slice(0, 10))}` : ""}
                          </span>
                        ) : (
                          <span className="mgr-pill">Not sent</span>
                        )}
                        {isExpired(q) && q.status !== "void" && <div className="sub">Expired</div>}
                      </td>
                      <td className="num">{formatMoney(totals.totalCents)}</td>
                      <td className="num">
                        {q.status !== "void" && (
                          <SendInvoice
                            id={q.id}
                            email={q.customer.email}
                            alreadySent={q.status === "sent"}
                            disabled={!ready}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
