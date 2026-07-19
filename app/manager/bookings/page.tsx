import Link from "next/link";
import { listBookings } from "@/lib/db";
import { formatDateLong, formatMoney, formatTime, isValidISODate, todayISO } from "@/lib/format";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

function matchesQuery(b: Booking, q: string): boolean {
  const hay = [
    b.reference,
    b.customer.firstName,
    b.customer.lastName,
    b.customer.email,
    b.customer.phone,
    ...b.items.map((i) => i.roomName),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export default async function ManagerBookings({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; date?: string; scope?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const date = params.date && isValidISODate(params.date) ? params.date : null;
  const scope = params.scope === "past" ? "past" : params.scope === "all" ? "all" : "upcoming";
  const today = todayISO();

  let bookings = await listBookings();
  if (q) bookings = bookings.filter((b) => matchesQuery(b, q));
  if (date) bookings = bookings.filter((b) => b.items.some((i) => i.date === date));
  if (!date && scope !== "all") {
    bookings = bookings.filter((b) => {
      const lastGame = Math.max(...b.items.map((i) => (i.date >= today ? 1 : 0)));
      return scope === "upcoming" ? lastGame === 1 : lastGame === 0;
    });
  }

  const scopeLink = (s: string, label: string) => (
    <Link
      href={`/manager/bookings?scope=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
      className={`btn btn-outline${!date && scope === s ? " active" : ""}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <h1 className="mgr-page-title">Bookings</h1>
      <p className="mgr-page-sub">Every booking customers have made. Click one for full details.</p>

      <div className="mgr-actions-row">
        <form action="/manager/bookings" method="get" className="mgr-inline-form">
          <div className="field">
            <label htmlFor="q">Search</label>
            <input
              type="text"
              id="q"
              name="q"
              defaultValue={q}
              placeholder="Name, email, phone, reference or experience"
              style={{ minWidth: 320 }}
            />
          </div>
          {date && <input type="hidden" name="date" value={date} />}
          <button type="submit" className="btn">
            Search
          </button>
          {(q || date) && (
            <Link href="/manager/bookings" className="btn btn-outline">
              Clear
            </Link>
          )}
        </form>
        <div className="mgr-range-tabs">
          {scopeLink("upcoming", "Upcoming")}
          {scopeLink("past", "Past")}
          {scopeLink("all", "All")}
        </div>
      </div>

      {date && (
        <p className="mgr-page-sub">
          Showing bookings with a session on <strong>{formatDateLong(date)}</strong>.
        </p>
      )}

      {bookings.length === 0 ? (
        <p className="mgr-empty">
          No bookings found{q ? ` for “${q}”` : ""}. Try a different search or scope.
        </p>
      ) : (
        <div className="mgr-table-wrap">
          <table className="mgr-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Customer</th>
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
                  </td>
                  <td>
                    {b.customer.firstName} {b.customer.lastName}
                    <br />
                    <span style={{ color: "var(--text-secondary)" }}>{b.customer.email}</span>
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
      )}
    </>
  );
}
