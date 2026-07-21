import Link from "next/link";
import { notFound } from "next/navigation";
import { listBookings } from "@/lib/db";
import { formatDateLong, formatMoney, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ManagerCustomerDetail({
  params,
}: {
  params: Promise<{ email: string }>;
}) {
  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail).toLowerCase();

  const all = await listBookings();
  const bookings = all
    .filter((b) => b.customer.email.toLowerCase() === email)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (bookings.length === 0) notFound();

  // Most recent booking holds the freshest contact details.
  const latest = bookings[0];
  const { customer } = latest;
  const name = `${customer.firstName} ${customer.lastName}`;

  const guests = bookings.reduce(
    (s, b) => s + b.items.reduce((t, i) => t + i.quantity, 0),
    0
  );
  const paidCents = bookings.reduce((s, b) => s + b.pricing.paidCents, 0);
  const balanceCents = bookings.reduce((s, b) => s + b.pricing.balanceCents, 0);

  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/customers">← Back to all customers</Link>
      </p>
      <h1 className="mgr-page-title">{name}</h1>
      <p className="mgr-page-sub">
        Customer since {formatDateLong(bookings[bookings.length - 1].createdAt.slice(0, 10))}.
      </p>

      <div className="mgr-card">
        <h2>Contact</h2>
        <p>
          <a href={`mailto:${customer.email}`}>{customer.email}</a>
          <br />
          <a href={`tel:${customer.phone}`}>{customer.phone}</a>
          <br />
          <span style={{ color: "var(--text-secondary)" }}>
            {customer.subscribe ? "Subscribed to marketing emails" : "Not subscribed to marketing emails"}
          </span>
        </p>
      </div>

      <div className="mgr-stats">
        <div className="mgr-stat">
          <div className="label">Bookings</div>
          <div className="value">{bookings.length}</div>
          <div className="hint">to date</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Guests brought</div>
          <div className="value">{guests}</div>
          <div className="hint">across all bookings</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Paid to date</div>
          <div className="value">{formatMoney(paidCents)}</div>
          <div className="hint">collected at booking</div>
        </div>
        <div className="mgr-stat">
          <div className="label">Balance due</div>
          <div className="value">{formatMoney(balanceCents)}</div>
          <div className="hint">{balanceCents > 0 ? "collect at the venue" : "nothing owing"}</div>
        </div>
      </div>

      <div className="mgr-card">
        <h2>Bookings</h2>
        <div className="mgr-table-wrap">
          <table className="mgr-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Sessions</th>
                <th className="num">Guests</th>
                <th className="num">Total</th>
                <th className="num">Paid</th>
                <th className="num">Balance due</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/manager/bookings/${b.id}`}>{b.reference}</Link>
                    {b.source === "in_person" && (
                      <>
                        <br />
                        <span className="mgr-pill">In-person</span>
                      </>
                    )}
                    {b.noShow && (
                      <>
                        <br />
                        <span className="mgr-pill" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                          No-show
                        </span>
                      </>
                    )}
                  </td>
                  <td>
                    {b.items.map((i, idx) => (
                      <div key={idx}>
                        {i.roomName} — {formatDateLong(i.date)}, {formatTime(i.time)}
                      </div>
                    ))}
                  </td>
                  <td className="num">{b.items.reduce((s, i) => s + i.quantity, 0)}</td>
                  <td className="num">{formatMoney(b.pricing.totalCents)}</td>
                  <td className="num">{formatMoney(b.pricing.paidCents)}</td>
                  <td className="num">
                    {b.pricing.balanceCents > 0 ? (
                      <strong style={{ color: "var(--danger)" }}>{formatMoney(b.pricing.balanceCents)}</strong>
                    ) : (
                      "Paid in full"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
