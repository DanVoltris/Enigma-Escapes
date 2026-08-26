import BoardPage from "@/components/manager/BoardPage";
import BookingsSubnav from "@/components/manager/BookingsSubnav";
import Link from "next/link";
import { allowedLocations, requirePermission } from "@/lib/auth";
import BookingsFilterBar from "@/components/manager/BookingsFilterBar";
import { bookingsRosterPage, listBookings } from "@/lib/db";
import { addDaysISO, businessDateOf, formatDateLong, formatMoney, formatTime, isValidISODate, localeConfig, todayISO } from "@/lib/format";
import { outstandingCents } from "@/lib/pricing";
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

const RANGES = ["30d", "7d", "24h", "all", "custom"] as const;
type Range = (typeof RANGES)[number];

export default async function ManagerBookings({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    date?: string;
    range?: string;
    from?: string;
    to?: string;
    status?: string;
    pay?: string;
    page?: string;
  }>;
}) {
  const staff = await requirePermission("bookings.view", "/manager/bookings");
  const scope = allowedLocations(staff); // null = every location
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const date = params.date && isValidISODate(params.date) ? params.date : null;
  const range: Range = RANGES.includes(params.range as Range) ? (params.range as Range) : "30d";
  const from = params.from && isValidISODate(params.from) ? params.from : null;
  const to = params.to && isValidISODate(params.to) ? params.to : null;
  const status = params.status === "active" || params.status === "noshow" ? params.status : "all";
  const pay = params.pay === "paid" || params.pay === "unpaid" ? params.pay : "all";
  const today = todayISO();

  // Only a screenful is rendered and, when the bookings_roster function is
  // installed, only a screenful is even fetched — filtered, sorted and counted
  // in Postgres. "All time" over the imported history is tens of thousands of
  // bookings; putting them in the HTML (or dragging them across the wire) is
  // what used to make this page unusable.
  const PER_PAGE = 200;
  const requested = Math.max(1, Math.floor(Number(params.page)) || 1);
  const roster = await bookingsRosterPage({
    q,
    status,
    pay,
    date,
    timezone: localeConfig().timezone,
    // Purchase-date range (venue-local business days; "24h" is a true rolling day).
    fromDay:
      range === "7d" || range === "30d"
        ? addDaysISO(today, range === "7d" ? -7 : -30)
        : range === "custom"
          ? from
          : null,
    toDay: range === "custom" ? to : null,
    since: range === "24h" ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() : null,
    locations: scope,
    limit: PER_PAGE,
    offset: (requested - 1) * PER_PAGE,
  });

  // Past the end (stale bookmark): show the first page instead.
  const fixed =
    roster && roster.rows.length === 0 && requested > 1
      ? await bookingsRosterPage({
          q, status, pay, date,
          timezone: localeConfig().timezone,
          fromDay:
            range === "7d" || range === "30d"
              ? addDaysISO(today, range === "7d" ? -7 : -30)
              : range === "custom" ? from : null,
          toDay: range === "custom" ? to : null,
          since: range === "24h" ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() : null,
          locations: scope,
          limit: PER_PAGE,
          offset: 0,
        })
      : roster;

  let total: number;
  let shown: Booking[];
  if (fixed) {
    total = fixed.total;
    shown = fixed.rows;
  } else {
    // Fallback while the SQL function isn't installed (and for local-data
    // mode): fetch a purchase-date window and filter in memory, like before.
    const prefetchSince =
      range === "24h"
        ? new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
        : range === "7d" || range === "30d"
          ? `${addDaysISO(today, (range === "7d" ? -7 : -30) - 1)}T00:00:00Z`
          : range === "custom" && from
            ? `${addDaysISO(from, -1)}T00:00:00Z`
            : undefined; // "all", or a custom range with no start date
    let bookings = await listBookings({ includeCancelled: true, since: prefetchSince });
    if (scope) bookings = bookings.filter((b) => b.items.some((i) => scope.includes(i.location)));
    if (q) bookings = bookings.filter((b) => matchesQuery(b, q));
    if (date) bookings = bookings.filter((b) => b.items.some((i) => i.date === date));
    if (range === "24h") {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      bookings = bookings.filter((b) => new Date(b.createdAt).getTime() >= cutoff);
    } else if (range === "7d" || range === "30d") {
      const first = addDaysISO(today, range === "7d" ? -7 : -30);
      bookings = bookings.filter((b) => businessDateOf(b.createdAt) >= first);
    } else if (range === "custom") {
      bookings = bookings.filter((b) => {
        const d = businessDateOf(b.createdAt);
        return (!from || d >= from) && (!to || d <= to);
      });
    }
    if (status !== "all") bookings = bookings.filter((b) => (status === "noshow" ? b.noShow : !b.noShow));
    if (pay !== "all") bookings = bookings.filter((b) => (pay === "paid" ? b.pricing.balanceCents <= 0 : b.pricing.balanceCents > 0));
    total = bookings.length;
    shown = bookings.slice((requested - 1) * PER_PAGE, requested * PER_PAGE);
  }
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const current = Math.min(requested, pageCount);
  const pageHref = (n: number) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (date) qs.set("date", date);
    if (params.range) qs.set("range", range);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (status !== "all") qs.set("status", status);
    if (pay !== "all") qs.set("pay", pay);
    if (n > 1) qs.set("page", String(n));
    const s = qs.toString();
    return `/manager/bookings${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <BoardPage />
      <div className="mgr-actions-row">
        <div>
          <h1 className="mgr-page-title">Bookings</h1>
          <p style={{ color: "var(--text-secondary)" }}>Every booking, online and in-person. Click one for full details.</p>
        </div>
        <Link href="/manager/bookings/new" className="btn">
          + Book now
        </Link>
      </div>

      <BookingsSubnav />

      <BookingsFilterBar />

      {date && (
        <p className="mgr-page-sub" style={{ marginTop: 14 }}>
          Showing bookings with a session on <strong>{formatDateLong(date)}</strong>.
        </p>
      )}
      <div className="mgr-card" style={{ marginTop: 18 }}>
      <h2>
        {total.toLocaleString()} booking{total === 1 ? "" : "s"}
        {range === "30d" && " in the last 30 days"}
        {range === "7d" && " in the last 7 days"}
        {range === "24h" && " in the last 24 hours"}
        {range === "custom" && ` from ${from ? formatDateLong(from) : "the beginning"} to ${to ? formatDateLong(to) : "today"}`}
        {status === "active" && " · attending"}
        {status === "noshow" && " · no-shows"}
        {pay === "paid" && " · paid in full"}
        {pay === "unpaid" && " · with a balance due"}
      </h2>

      {total === 0 ? (
        <p className="mgr-empty">
          No bookings found{q ? ` for “${q}”` : ""}. Widen the purchase-date range or clear the filters.
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
              {shown.map((b) => (
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
                    {b.status === "pending" && (
                      <>
                        <br />
                        <span className="mgr-pill">Awaiting payment</span>
                      </>
                    )}
                    {b.status === "cancelled" && (
                      <>
                        <br />
                        <span className="mgr-pill" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                          Cancelled
                        </span>
                        {/* what the customer is still owed, if Stripe didn't return it automatically */}
                        {(b.pricing.refundOwedCents ?? 0) > (b.pricing.refundedCents ?? 0) && (
                          <>
                            <br />
                            <span className="mgr-pill" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                              Refund owed {formatMoney((b.pricing.refundOwedCents ?? 0) - (b.pricing.refundedCents ?? 0))}
                            </span>
                          </>
                        )}
                      </>
                    )}
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
                    {/* Cancelled is neither owing nor paid in full — saying either
                        would send someone chasing money or filing it as settled. */}
                    {b.status === "cancelled" ? (
                      <span className="sub">—</span>
                    ) : b.pricing.balanceCents > 0 ? (
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

      {pageCount > 1 && (
        <p style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>
            Showing {((current - 1) * PER_PAGE + 1).toLocaleString()}–
            {Math.min(current * PER_PAGE, total).toLocaleString()} of {total.toLocaleString()} · page{" "}
            {current.toLocaleString()} of {pageCount.toLocaleString()}
          </span>
          <span>
            {current > 1 ? <Link href={pageHref(current - 1)}>← Previous</Link> : <span className="sub">← Previous</span>}
            {" · "}
            {current < pageCount ? <Link href={pageHref(current + 1)}>Next →</Link> : <span className="sub">Next →</span>}
          </span>
        </p>
      )}
      </div>
    </>
  );
}
