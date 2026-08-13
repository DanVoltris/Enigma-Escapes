import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { notFound } from "next/navigation";
import CustomerTabs, { type Payment, type Promo, type Purchase, type Tax } from "@/components/manager/CustomerTabs";
import { listManualCustomers } from "@/lib/customers";
import { listBookings } from "@/lib/db";
import { listExperiences } from "@/lib/experiences";
import { formatDateLong, formatMoney, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function initials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "?";
}

export default async function ManagerCustomerDetail({
  params,
}: {
  params: Promise<{ email: string }>;
}) {
  await requirePermission("customers.view", "/manager/customers/[email]");
  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail).toLowerCase();

  const [all, experiences, manual] = await Promise.all([
    listBookings(),
    listExperiences(),
    listManualCustomers(),
  ]);
  const bookings = all
    .filter((b) => b.customer.email.toLowerCase() === email)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Imported and hand-added people have no bookings here yet, so the stored
  // record is all there is to go on.
  const record = manual.find((m) => m.email.toLowerCase() === email) ?? null;

  if (bookings.length === 0 && !record) notFound();

  const expMap = new Map(experiences.map((e) => [e.id, e]));

  // Most recent booking holds the freshest contact details; failing that, the
  // stored record does.
  const latest = bookings[0] ?? null;
  const customer = latest
    ? latest.customer
    : {
        firstName: record!.firstName,
        lastName: record!.lastName,
        email: record!.email,
        phone: record!.phone,
        subscribe: record!.subscribe,
      };
  const imported = record?.imported ?? null;
  const name = `${customer.firstName} ${customer.lastName}`.trim();
  const since = (latest ? bookings[bookings.length - 1].createdAt : record!.createdAt).slice(0, 10);
  const guests = bookings.reduce((s, b) => s + b.items.reduce((t, i) => t + i.quantity, 0), 0);
  const num = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  // Lifetime money totals across every booking (real pricing, incl. tax).
  const sum = (f: (p: (typeof bookings)[number]["pricing"]) => number) =>
    bookings.reduce((s, b) => s + f(b.pricing), 0);
  const totals = {
    subtotal: sum((p) => p.subtotalCents),
    discount: sum((p) => p.discountCents),
    tax: sum((p) => p.gstCents),
    total: sum((p) => p.totalCents),
    paid: sum((p) => p.paidCents),
    due: sum((p) => p.balanceCents),
  };

  const purchases: Purchase[] = bookings.flatMap((b) =>
    b.items.map((i) => ({
      bookingId: b.id,
      reference: b.reference,
      roomName: i.roomName,
      imageUrl: expMap.get(i.roomId)?.imageUrl ?? null,
      badgeBg: i.badgeBg,
      badgeFg: i.badgeFg,
      when: `${formatDateLong(i.date)} · ${formatTime(i.time)}`,
      duration: `${i.durationMinutes} min`,
      quantity: i.quantity,
      amountCents: i.priceCents * i.quantity,
    }))
  );
  const payments: Payment[] = bookings.map((b) => ({
    bookingId: b.id,
    reference: b.reference,
    method: b.paymentOption === "deposit" ? "Deposit" : "Paid in full",
    totalCents: b.pricing.totalCents,
    paidCents: b.pricing.paidCents,
    balanceCents: b.pricing.balanceCents,
  }));
  const taxes: Tax[] = bookings.map((b) => ({
    bookingId: b.id,
    reference: b.reference,
    subtotalCents: b.pricing.subtotalCents,
    gstCents: b.pricing.gstCents,
  }));
  const promos: Promo[] = bookings
    .filter((b) => b.promoCode)
    .map((b) => ({ bookingId: b.id, reference: b.reference, code: b.promoCode as string }));

  return (
    <>
      <div className="cust-topbar">
        <Link href="/manager/customers">← Back to all customers</Link>
        <div className="cust-topbar-actions">
          <a href={`mailto:${customer.email}`} className="btn btn-outline">
            Email
          </a>
          <Link href="/manager/bookings/new" className="btn">
            + New booking
          </Link>
        </div>
      </div>

      <div className="cust-profile">
        <aside className="cust-side">
          <div className="cust-avatar" aria-hidden="true">
            {initials(customer.firstName, customer.lastName)}
          </div>
          <h1 className="cust-name">{name}</h1>
          <p className="cust-since">Customer since {formatDateLong(since)}</p>

          <dl className="cust-facts">
            <div>
              <dt>Bookings</dt>
              <dd>{bookings.length + num(imported?.bookings)}</dd>
            </div>
            <div>
              <dt>Guests brought</dt>
              <dd>{guests || "—"}</dd>
            </div>
          </dl>

          <div className="cust-info">
            <h2>Information</h2>
            <p>
              <span className="cust-info-row">
                <span className="ico" aria-hidden="true">✉</span>
                <a href={`mailto:${customer.email}`}>{customer.email}</a>
              </span>
              <span className="cust-info-row">
                <span className="ico" aria-hidden="true">☎</span>
                <a href={`tel:${customer.phone}`}>{customer.phone}</a>
              </span>
              <span className="cust-info-row">
                <span className="ico" aria-hidden="true">✦</span>
                <span className="sub">
                  {customer.subscribe ? "Subscribed to marketing emails" : "Not subscribed to marketing emails"}
                </span>
              </span>
              {imported?.altPhone && (
                <span className="cust-info-row">
                  <span className="ico" aria-hidden="true">☎</span>
                  <a href={`tel:${imported.altPhone}`}>{imported.altPhone}</a>
                </span>
              )}
            </p>
          </div>

          {imported && (
            <div className="cust-info">
              <h2>Previous booking system</h2>
              <p>
                <span className="cust-info-row">
                  <span className="sub">
                    {num(imported.bookings)} booking{num(imported.bookings) === 1 ? "" : "s"} ·{" "}
                    {formatMoney(num(imported.paidCents))} paid
                  </span>
                </span>
                {num(imported.unpaidCents) > 0 && (
                  <span className="cust-info-row">
                    <span className="sub">{formatMoney(num(imported.unpaidCents))} left unpaid</span>
                  </span>
                )}
                {num(imported.creditRemainingCents) > 0 && (
                  <span className="cust-info-row">
                    <span className="sub">
                      {formatMoney(num(imported.creditRemainingCents))} credit remaining
                    </span>
                  </span>
                )}
                {imported.lastAttended && (
                  <span className="cust-info-row">
                    <span className="sub">
                      Last played {imported.lastAttended}
                      {imported.lastItem ? ` — ${imported.lastItem}` : ""}
                    </span>
                  </span>
                )}
              </p>
            </div>
          )}
        </aside>

        <div className="cust-main">
          <div className="mgr-card">
            <CustomerTabs purchases={purchases} payments={payments} taxes={taxes} promos={promos} />

            <div className="cust-totals">
              <div>
                <div className="label">Subtotal</div>
                <div className="value">{formatMoney(totals.subtotal)}</div>
              </div>
              {totals.discount > 0 && (
                <div>
                  <div className="label">Discounts</div>
                  <div className="value">−{formatMoney(totals.discount)}</div>
                </div>
              )}
              <div>
                <div className="label">Taxes</div>
                <div className="value">{formatMoney(totals.tax)}</div>
              </div>
              <div>
                <div className="label">Total</div>
                <div className="value">{formatMoney(totals.total)}</div>
              </div>
              <div>
                <div className="label">Total paid</div>
                <div className="value">{formatMoney(totals.paid)}</div>
              </div>
              <div>
                <div className="label">Total due</div>
                <div className={`value${totals.due > 0 ? " due" : ""}`}>{formatMoney(totals.due)}</div>
              </div>
            </div>
          </div>

          <div className="mgr-two-col">
            <div className="mgr-card">
              <h2>Activity</h2>
              {bookings.length === 0 && (
                <p className="cust-empty">
                  {imported
                    ? "Nothing yet — this customer came over from the previous booking system, so their history isn't itemised here."
                    : "No bookings yet."}
                </p>
              )}
              <ul className="cust-activity">
                {bookings.map((b) => {
                  const created = new Date(b.createdAt);
                  const rooms = Array.from(new Set(b.items.map((i) => i.roomName))).join(", ");
                  return (
                    <li key={b.id}>
                      <span className="dot" aria-hidden="true">
                        {initials(customer.firstName, customer.lastName)}
                      </span>
                      <div className="body">
                        <div>
                          {b.source === "in_person" ? "Walk-in booking" : "Online booking"}{" "}
                          <Link href={`/manager/bookings/${b.id}`}>{b.reference}</Link> created for {rooms} —{" "}
                          {formatMoney(b.pricing.totalCents)}
                          {b.noShow ? " · marked no-show" : ""}
                        </div>
                        <div className="when">
                          {created.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="mgr-card">
              <h2>Notes</h2>
              <p className="cust-empty">No notes have been created yet.</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
