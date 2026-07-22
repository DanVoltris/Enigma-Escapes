import Link from "next/link";
import BarChart from "@/components/manager/BarChart";
import ReportsFilterBar from "@/components/manager/ReportsFilterBar";
import { AreaChart, Donut, type SeriesPoint, type Slice } from "@/components/manager/charts";
import { listBookings } from "@/lib/db";
import { listExperiences } from "@/lib/experiences";
import { locationHoursMap } from "@/lib/hours";
import { startTimesFor } from "@/lib/schedule";
import { addDaysISO, businessDateOf, dateBadgeParts, formatDateLong, formatMoney, isValidISODate, todayISO } from "@/lib/format";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

// Validated report palette (dataviz six-checks, light surface): status pair and
// payment trio pass; red/green sits in the CVD floor band, so every donut adds
// secondary encoding (white slice gaps + labelled legend with counts).
const GOOD = "#1f7a4d";
const BAD = "#c43b3b";
const MID = "#2b7bb9";

const TABS = [
  { section: "Transactional", key: "sales", label: "Sales" },
  { section: "Transactional", key: "bookings", label: "Bookings" },
  { section: "Transactional", key: "payments", label: "Payments" },
  { section: "Inventory", key: "items", label: "Experiences" },
  { section: "Inventory", key: "extras", label: "Extras" },
  { section: "Inventory", key: "vouchers", label: "Gift vouchers" },
  { section: "Misc", key: "guests", label: "Guests" },
  { section: "Misc", key: "capacity", label: "Capacity" },
  { section: "Misc", key: "discounts", label: "Discounts" },
  { section: "Misc", key: "abandonment", label: "Cart abandonment" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  while (d <= to && out.length < 400) {
    out.push(d);
    d = addDaysISO(d, 1);
  }
  return out;
}

function shortDay(d: string, span: number): string {
  if (span > 8) return d.slice(5); // "07-21"
  const p = dateBadgeParts(d);
  return `${p.weekday} ${p.day}`; // "TUE 21"
}

// Signed percent change vs the previous period; null when there's no baseline.
function delta(now: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((now - prev) / prev) * 100);
}

function DeltaTag({ pct, upIsGood }: { pct: number | null; upIsGood: boolean | null }) {
  if (pct === null) return <span className="rpt-delta muted">— vs prev period</span>;
  const cls = upIsGood === null ? "muted" : (pct >= 0) === upIsGood ? "good" : "bad";
  return (
    <span className={`rpt-delta ${cls}`}>
      {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}% vs prev period
    </span>
  );
}

export default async function ManagerReports({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string; from?: string; to?: string; status?: string; view?: string }>;
}) {
  const params = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === params.tab) ? (params.tab as TabKey) : "sales";
  const today = todayISO();

  // Resolve the date window (defaults to the last 7 days, like the presets).
  let rangeDays = params.range === "30" ? 30 : params.range === "90" ? 90 : 7;
  let from = addDaysISO(today, -(rangeDays - 1));
  let to = today;
  if (params.range === "custom") {
    const f = params.from && isValidISODate(params.from) ? params.from : from;
    const t = params.to && isValidISODate(params.to) ? params.to : to;
    if (f <= t) {
      from = f;
      to = t;
    }
    rangeDays = eachDay(from, to).length;
  }
  const status = params.status === "active" || params.status === "noshow" ? params.status : "all";
  const view = params.view === "table" ? ("table" as const) : ("chart" as const);

  const bookings = await listBookings();

  // Purchase-dated set for transactional tabs (+ the same window one period back
  // for the delta arrows); inventory/capacity tabs slice by session date instead.
  const purchased = bookings.filter((b) => {
    const d = businessDateOf(b.createdAt);
    return d >= from && d <= to;
  });
  const prevPurchased = bookings.filter((b) => {
    const d = businessDateOf(b.createdAt);
    return d >= addDaysISO(from, -rangeDays) && d <= addDaysISO(from, -1);
  });

  const active = TABS.find((t) => t.key === tab)!;
  const sections = ["Transactional", "Inventory", "Misc"] as const;
  const qs = (k: TabKey) => {
    const p = new URLSearchParams();
    p.set("tab", k);
    if (params.range) p.set("range", params.range);
    if (params.from) p.set("from", params.from);
    if (params.to) p.set("to", params.to);
    return `/manager/reports?${p.toString()}`;
  };

  return (
    <>
      <h1 className="mgr-page-title">Reports</h1>

      <div className="rpt-layout">
        <nav className="rpt-nav" aria-label="Report types">
          {sections.map((s) => (
            <div key={s}>
              <h3>{s}</h3>
              <ul>
                {TABS.filter((t) => t.section === s).map((t) => (
                  <li key={t.key}>
                    <Link href={qs(t.key)} className={t.key === tab ? "active" : undefined}>
                      {t.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="rpt-content">
          <h2 className="rpt-title">{active.label}</h2>
          <ReportsFilterBar withStatus={tab === "sales"} />
          <p className="mgr-page-sub" style={{ marginTop: -10 }}>
            {formatDateLong(from)} — {formatDateLong(to)}
          </p>

          {tab === "sales" && (
            <SalesTab
              purchased={
                status === "all" ? purchased : purchased.filter((b) => (status === "noshow" ? b.noShow : !b.noShow))
              }
              prev={prevPurchased}
              from={from}
              to={to}
              view={view}
              params={params}
            />
          )}
          {tab === "bookings" && <BookingsTab bookings={bookings} from={from} to={to} />}
          {tab === "payments" && <PaymentsTab purchased={purchased} />}
          {tab === "items" && <ItemsTab bookings={bookings} from={from} to={to} />}
          {tab === "extras" && (
            <p className="mgr-empty">
              Extras (add-ons sold with a booking) aren&apos;t part of the product yet — nothing to report.
            </p>
          )}
          {tab === "vouchers" && (
            <p className="mgr-empty">
              Gift vouchers aren&apos;t set up yet — promo codes are the only discount instrument today.
            </p>
          )}
          {tab === "guests" && <GuestsTab purchased={purchased} />}
          {tab === "capacity" && <CapacityTab bookings={bookings} from={from} to={to} today={today} />}
          {tab === "discounts" && <DiscountsTab purchased={purchased} />}
          {tab === "abandonment" && (
            <p className="mgr-empty">
              Cart abandonment isn&apos;t tracked — carts live in the visitor&apos;s browser until checkout, so
              abandoned ones never reach the server. Say the word if you want hold events recorded.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function SalesTab({
  purchased,
  prev,
  from,
  to,
  view,
  params,
}: {
  purchased: Booking[];
  prev: Booking[];
  from: string;
  to: string;
  view: "chart" | "table";
  params: { range?: string; from?: string; to?: string; status?: string };
}) {
  const sum = (list: Booking[], f: (b: Booking) => number) => list.reduce((s, b) => s + f(b), 0);
  const now = {
    count: purchased.length,
    sales: sum(purchased, (b) => b.pricing.totalCents),
    taxes: sum(purchased, (b) => b.pricing.gstCents),
    discounts: sum(purchased, (b) => b.pricing.discountCents),
    paid: sum(purchased, (b) => b.pricing.paidCents),
    unpaid: sum(purchased, (b) => Math.max(0, b.pricing.balanceCents)),
  };
  const was = {
    count: prev.length,
    sales: sum(prev, (b) => b.pricing.totalCents),
    taxes: sum(prev, (b) => b.pricing.gstCents),
    discounts: sum(prev, (b) => b.pricing.discountCents),
    paid: sum(prev, (b) => b.pricing.paidCents),
    unpaid: sum(prev, (b) => Math.max(0, b.pricing.balanceCents)),
  };

  const days = eachDay(from, to);
  const byDay = new Map<string, { sales: number; count: number }>();
  for (const b of purchased) {
    const d = businessDateOf(b.createdAt);
    const agg = byDay.get(d) ?? { sales: 0, count: 0 };
    agg.sales += b.pricing.totalCents;
    agg.count += 1;
    byDay.set(d, agg);
  }
  const points: SeriesPoint[] = days.map((d) => {
    const agg = byDay.get(d);
    return {
      label: shortDay(d, days.length),
      value: agg?.sales ?? 0,
      display: `${formatDateLong(d)}: ${formatMoney(agg?.sales ?? 0)} · ${agg?.count ?? 0} transaction${
        (agg?.count ?? 0) === 1 ? "" : "s"
      }`,
    };
  });

  const statusSlices: Slice[] = [
    { label: "Attending", value: purchased.filter((b) => !b.noShow).length, color: GOOD },
    { label: "No-show", value: purchased.filter((b) => b.noShow).length, color: BAD },
  ];
  const paymentSlices: Slice[] = [
    { label: "Paid in full", value: purchased.filter((b) => b.pricing.balanceCents <= 0).length, color: GOOD },
    {
      label: "Partially paid",
      value: purchased.filter((b) => b.pricing.balanceCents > 0 && b.pricing.paidCents > 0).length,
      color: MID,
    },
    {
      label: "Unpaid",
      value: purchased.filter((b) => b.pricing.balanceCents > 0 && b.pricing.paidCents <= 0).length,
      color: BAD,
    },
  ];
  const channels = [
    { label: "Booking site", value: purchased.filter((b) => b.source === "online").length },
    { label: "Walk-in", value: purchased.filter((b) => b.source === "in_person").length },
  ];

  const viewQS = (v: string) => {
    const p = new URLSearchParams();
    p.set("tab", "sales");
    for (const [k, val] of Object.entries(params)) if (val) p.set(k, val);
    if (v === "table") p.set("view", "table");
    else p.delete("view");
    return `/manager/reports?${p.toString()}`;
  };

  return (
    <>
      <div className="rpt-tiles">
        <div className="rpt-tile">
          <div className="label">Transactions</div>
          <div className="value">{now.count}</div>
          <DeltaTag pct={delta(now.count, was.count)} upIsGood={true} />
        </div>
        <div className="rpt-tile">
          <div className="label">Sales</div>
          <div className="value">{formatMoney(now.sales)}</div>
          <DeltaTag pct={delta(now.sales, was.sales)} upIsGood={true} />
        </div>
        <div className="rpt-tile">
          <div className="label">Taxes</div>
          <div className="value">{formatMoney(now.taxes)}</div>
          <DeltaTag pct={delta(now.taxes, was.taxes)} upIsGood={null} />
        </div>
        <div className="rpt-tile">
          <div className="label">Discounts</div>
          <div className="value">{formatMoney(now.discounts)}</div>
          <DeltaTag pct={delta(now.discounts, was.discounts)} upIsGood={null} />
        </div>
        <div className="rpt-tile">
          <div className="label">Paid</div>
          <div className="value" style={{ color: GOOD }}>
            {formatMoney(now.paid)}
          </div>
          <DeltaTag pct={delta(now.paid, was.paid)} upIsGood={true} />
        </div>
        <div className="rpt-tile">
          <div className="label">Unpaid</div>
          <div className="value" style={{ color: now.unpaid > 0 ? BAD : undefined }}>
            {formatMoney(now.unpaid)}
          </div>
          <DeltaTag pct={delta(now.unpaid, was.unpaid)} upIsGood={false} />
        </div>
      </div>

      <div className="mgr-card">
        <div className="mgr-actions-row" style={{ marginBottom: 8 }}>
          <h2 style={{ marginBottom: 0 }}>Sales over time</h2>
          <div className="mgr-range-tabs">
            <Link href={viewQS("chart")} className={`btn btn-outline${view === "chart" ? " active" : ""}`}>
              Chart
            </Link>
            <Link href={viewQS("table")} className={`btn btn-outline${view === "table" ? " active" : ""}`}>
              Table
            </Link>
          </div>
        </div>
        <p className="card-sub">Billed totals (incl. tax) by the day the booking was placed. Hover for exact figures.</p>
        {view === "chart" ? (
          <AreaChart points={points} ariaLabel="Sales by day" />
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th className="num">Transactions</th>
                  <th className="num">Sales</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d}>
                    <td>{formatDateLong(d)}</td>
                    <td className="num">{byDay.get(d)?.count ?? 0}</td>
                    <td className="num">{formatMoney(byDay.get(d)?.sales ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rpt-cards">
        <div className="mgr-card">
          <h2>Transactions by status</h2>
          <Donut slices={statusSlices} ariaLabel="Transactions by attendance status" />
        </div>
        <div className="mgr-card">
          <h2>By payment status</h2>
          <Donut slices={paymentSlices} ariaLabel="Transactions by payment status" />
        </div>
        <div className="mgr-card">
          <h2>By channel</h2>
          {purchased.length === 0 ? (
            <p className="cust-empty">Nothing in this period.</p>
          ) : (
            <BarChart
              bars={channels.map((c) => ({ label: c.label, value: c.value, displayValue: String(c.value) }))}
              ariaLabel="Transactions by channel"
            />
          )}
        </div>
      </div>

      <div className="rpt-cards">
        <div className="mgr-card">
          <h2>By devices &amp; browsers</h2>
          <p className="cust-empty">Not tracked — the booking site doesn&apos;t collect device or browser details.</p>
        </div>
        <div className="mgr-card">
          <h2>By staff user</h2>
          <p className="cust-empty">Not tracked yet — needs the staff login, which is still to be built.</p>
        </div>
      </div>
    </>
  );
}

function BookingsTab({ bookings, from, to }: { bookings: Booking[]; from: string; to: string }) {
  // Session-dated: what actually ran (or will run) in the window.
  let sessions = 0;
  let guests = 0;
  let grossCents = 0;
  const ids = new Set<string>();
  const byDay = new Map<string, number>();
  for (const b of bookings) {
    for (const i of b.items) {
      if (i.date < from || i.date > to) continue;
      sessions += 1;
      guests += i.quantity;
      grossCents += i.priceCents * i.quantity;
      ids.add(b.id);
      byDay.set(i.date, (byDay.get(i.date) ?? 0) + i.priceCents * i.quantity);
    }
  }
  const days = eachDay(from, to);

  return (
    <>
      <div className="rpt-tiles">
        <div className="rpt-tile">
          <div className="label">Bookings</div>
          <div className="value">{ids.size}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Sessions</div>
          <div className="value">{sessions}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Guests</div>
          <div className="value">{guests}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Gross</div>
          <div className="value">{formatMoney(grossCents)}</div>
        </div>
      </div>
      <div className="mgr-card">
        <h2>Gross by session day</h2>
        <p className="card-sub">Ticket price × guests for sessions running each day, before tax and discounts.</p>
        <AreaChart
          points={days.map((d) => ({
            label: shortDay(d, days.length),
            value: byDay.get(d) ?? 0,
            display: `${formatDateLong(d)}: ${formatMoney(byDay.get(d) ?? 0)}`,
          }))}
          ariaLabel="Gross sales by session day"
        />
      </div>
    </>
  );
}

function PaymentsTab({ purchased }: { purchased: Booking[] }) {
  const manual = purchased.flatMap((b) =>
    (b.pricing.payments ?? []).map((p) => ({ ...p, reference: b.reference, bookingId: b.id }))
  );
  const manualCents = manual.reduce((s, p) => s + p.amountCents, 0);
  const paidCents = purchased.reduce((s, b) => s + b.pricing.paidCents, 0);
  const onlineCents = paidCents - manualCents;
  const label: Record<string, string> = { cash: "Cash", card: "Card (terminal)", etransfer: "E-transfer", other: "Other" };
  const byMethod = new Map<string, { count: number; cents: number }>();
  byMethod.set("Online checkout", { count: purchased.filter((b) => b.pricing.paidCents > 0).length, cents: onlineCents });
  for (const p of manual) {
    const key = label[p.method] ?? p.method;
    const agg = byMethod.get(key) ?? { count: 0, cents: 0 };
    agg.count += 1;
    agg.cents += p.amountCents;
    byMethod.set(key, agg);
  }

  return (
    <>
      <div className="rpt-tiles">
        <div className="rpt-tile">
          <div className="label">Collected</div>
          <div className="value">{formatMoney(paidCents)}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Online checkout</div>
          <div className="value">{formatMoney(onlineCents)}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Recorded at venue</div>
          <div className="value">{formatMoney(manualCents)}</div>
        </div>
      </div>
      <div className="mgr-card">
        <h2>By method</h2>
        <div className="mgr-table-wrap">
          <table className="mgr-table">
            <thead>
              <tr>
                <th>Method</th>
                <th className="num">Payments</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(byMethod.entries()).map(([m, agg]) => (
                <tr key={m}>
                  <td>{m}</td>
                  <td className="num">{agg.count}</td>
                  <td className="num">{formatMoney(agg.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mgr-card">
        <h2>Payments recorded at the venue</h2>
        {manual.length === 0 ? (
          <p className="cust-empty">None in this period. Staff record them on a booking&apos;s Payments tab.</p>
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Booking</th>
                  <th>Method</th>
                  <th>Note</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {manual
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .map((p) => (
                    <tr key={p.id}>
                      <td>{new Date(p.at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td>
                        <Link href={`/manager/bookings/${p.bookingId}`}>{p.reference}</Link>
                      </td>
                      <td>{label[p.method] ?? p.method}</td>
                      <td>{p.note ?? ""}</td>
                      <td className="num">{formatMoney(p.amountCents)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function ItemsTab({ bookings, from, to }: { bookings: Booking[]; from: string; to: string }) {
  type Agg = { name: string; sessions: number; guests: number; grossCents: number };
  const byExp = new Map<string, Agg>();
  for (const b of bookings) {
    for (const i of b.items) {
      if (i.date < from || i.date > to) continue;
      const agg = byExp.get(i.roomId) ?? { name: i.roomName, sessions: 0, guests: 0, grossCents: 0 };
      agg.sessions += 1;
      agg.guests += i.quantity;
      agg.grossCents += i.priceCents * i.quantity;
      byExp.set(i.roomId, agg);
    }
  }
  const rows = Array.from(byExp.values()).sort((a, b) => b.grossCents - a.grossCents);

  return (
    <div className="mgr-card">
      <h2>By experience</h2>
      <p className="card-sub">Sessions running in this window, ranked by gross sales.</p>
      {rows.length === 0 ? (
        <p className="cust-empty">No sessions in this period.</p>
      ) : (
        <div className="mgr-table-wrap">
          <table className="mgr-table">
            <thead>
              <tr>
                <th>Experience</th>
                <th className="num">Sessions</th>
                <th className="num">Guests</th>
                <th className="num">Gross sales</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="num">{r.sessions}</td>
                  <td className="num">{r.guests}</td>
                  <td className="num">{formatMoney(r.grossCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GuestsTab({ purchased }: { purchased: Booking[] }) {
  const guests = purchased.reduce((s, b) => s + b.items.reduce((t, i) => t + i.quantity, 0), 0);
  const sizes = new Map<number, number>();
  for (const b of purchased) {
    const size = b.items.reduce((t, i) => t + i.quantity, 0);
    sizes.set(size, (sizes.get(size) ?? 0) + 1);
  }
  const bars = Array.from(sizes.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([size, count]) => ({
      label: `${size}`,
      value: count,
      displayValue: `${count} booking${count === 1 ? "" : "s"}`,
    }));

  return (
    <>
      <div className="rpt-tiles">
        <div className="rpt-tile">
          <div className="label">Guests</div>
          <div className="value">{guests}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Avg party size</div>
          <div className="value">{purchased.length ? (guests / purchased.length).toFixed(1) : "0"}</div>
        </div>
      </div>
      <div className="mgr-card">
        <h2>Party sizes</h2>
        <p className="card-sub">How many bookings were made at each party size in this period.</p>
        {bars.length === 0 ? (
          <p className="cust-empty">Nothing in this period.</p>
        ) : (
          <BarChart bars={bars} ariaLabel="Bookings by party size" />
        )}
      </div>
    </>
  );
}

async function CapacityTab({
  bookings,
  from,
  to,
  today,
}: {
  bookings: Booking[];
  from: string;
  to: string;
  today: string;
}) {
  // Utilization = guests booked ÷ seats offered, for sessions up to today.
  const end = to < today ? to : today;
  if (from > end) return <p className="mgr-empty">This window is entirely in the future — no sessions have run yet.</p>;
  const days = eachDay(from, end);
  if (days.length > 190) return <p className="mgr-empty">Narrow the range to 190 days or fewer to compute capacity.</p>;

  const [experiences, hoursMap] = await Promise.all([listExperiences({ activeOnly: true }), locationHoursMap()]);
  const bookedByExp = new Map<string, number>();
  for (const b of bookings) {
    for (const i of b.items) {
      if (i.date < from || i.date > end) continue;
      bookedByExp.set(i.roomId, (bookedByExp.get(i.roomId) ?? 0) + i.quantity);
    }
  }

  const rows = experiences.map((e) => {
    let offered = 0;
    for (const d of days) offered += startTimesFor(e, d, hoursMap.get(e.location) ?? null).length * e.capacity;
    const booked = bookedByExp.get(e.id) ?? 0;
    const pct = offered > 0 ? Math.round((booked / offered) * 100) : 0;
    return { name: e.name, location: e.location, offered, booked, pct };
  });

  return (
    <div className="mgr-card">
      <h2>Seat utilization</h2>
      <p className="card-sub">
        Guests booked against every seat offered between {formatDateLong(from)} and {formatDateLong(end)}.
      </p>
      <div className="mgr-table-wrap">
        <table className="mgr-table">
          <thead>
            <tr>
              <th>Experience</th>
              <th className="num">Seats offered</th>
              <th className="num">Booked</th>
              <th style={{ width: 220 }}>Utilization</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>
                  {r.name}
                  <br />
                  <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{r.location}</span>
                </td>
                <td className="num">{r.offered}</td>
                <td className="num">{r.booked}</td>
                <td>
                  <div className="mgr-meter" title={`${r.pct}%`}>
                    <div className="fill" style={{ width: `${Math.min(100, r.pct)}%` }} />
                  </div>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{r.pct}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiscountsTab({ purchased }: { purchased: Booking[] }) {
  const withPromo = purchased.filter((b) => b.promoCode);
  const byCode = new Map<string, { uses: number; discountCents: number; salesCents: number }>();
  for (const b of withPromo) {
    const agg = byCode.get(b.promoCode as string) ?? { uses: 0, discountCents: 0, salesCents: 0 };
    agg.uses += 1;
    agg.discountCents += b.pricing.discountCents;
    agg.salesCents += b.pricing.totalCents;
    byCode.set(b.promoCode as string, agg);
  }

  return (
    <>
      <div className="rpt-tiles">
        <div className="rpt-tile">
          <div className="label">Discounted bookings</div>
          <div className="value">{withPromo.length}</div>
        </div>
        <div className="rpt-tile">
          <div className="label">Discount given</div>
          <div className="value">{formatMoney(withPromo.reduce((s, b) => s + b.pricing.discountCents, 0))}</div>
        </div>
      </div>
      <div className="mgr-card">
        <h2>By promo code</h2>
        {byCode.size === 0 ? (
          <p className="cust-empty">No promo codes used in this period.</p>
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th className="num">Uses</th>
                  <th className="num">Discount given</th>
                  <th className="num">Sales after discount</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(byCode.entries()).map(([code, agg]) => (
                  <tr key={code}>
                    <td>
                      <span className="mgr-pill">{code}</span>
                    </td>
                    <td className="num">{agg.uses}</td>
                    <td className="num">{formatMoney(agg.discountCents)}</td>
                    <td className="num">{formatMoney(agg.salesCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
