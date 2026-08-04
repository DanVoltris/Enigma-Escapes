"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RoomBadge from "@/components/RoomBadge";
import SingleSelect from "@/components/SingleSelect";
import { formatMoney } from "@/lib/format";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "@/lib/payment-methods";
import type { BookingPayment, Participant } from "@/lib/types";

export type PurchaseLine = {
  roomName: string;
  imageUrl: string | null;
  badgeBg: string;
  badgeFg: string;
  when: string;
  duration: string;
  quantity: number;
  amountCents: number;
};

type Props = {
  bookingId: string;
  reference: string;
  purchases: PurchaseLine[];
  promoCode: string | null;
  discountCents: number;
  activePromos: { code: string; percentOff: number }[];
  customerName: string;
  customerEmail: string;
  participants: Participant[];
  taxes: { name: string; percent: number }[];
  gstCents: number;
  appliedTo: string;
  payments: BookingPayment[];
  onlinePaidCents: number; // paid at checkout, before any manual records
  balanceCents: number;
};

type TabKey = "purchases" | "promos" | "customers" | "taxes" | "payments" | "questions";

const METHOD_LABEL = PAYMENT_METHOD_LABEL;

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

export default function BookingTabs(props: Props) {
  const [tab, setTab] = useState<TabKey>("purchases");
  const paymentCount = (props.onlinePaidCents > 0 ? 1 : 0) + props.payments.length;

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "purchases", label: "All Purchases", count: props.purchases.length },
    { key: "promos", label: "Promos/Gifts", count: props.promoCode ? 1 : 0 },
    { key: "customers", label: "Customers", count: 1 + props.participants.length },
    { key: "taxes", label: "Taxes/Fees", count: props.gstCents > 0 ? Math.max(props.taxes.length, 1) : props.taxes.length },
    { key: "payments", label: "Payments", count: paymentCount },
    { key: "questions", label: "Questions", count: 0 },
  ];

  return (
    <>
      <div className="cust-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`cust-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="n">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="cust-tabpanel">
        {tab === "purchases" && <PurchasesTab purchases={props.purchases} />}
        {tab === "promos" && (
          <PromosTab
            bookingId={props.bookingId}
            promoCode={props.promoCode}
            discountCents={props.discountCents}
            activePromos={props.activePromos}
          />
        )}
        {tab === "customers" && (
          <CustomersTab
            bookingId={props.bookingId}
            customerName={props.customerName}
            customerEmail={props.customerEmail}
            participants={props.participants}
          />
        )}
        {tab === "taxes" && <TaxesTab taxes={props.taxes} gstCents={props.gstCents} appliedTo={props.appliedTo} />}
        {tab === "payments" && (
          <PaymentsTab
            bookingId={props.bookingId}
            payments={props.payments}
            onlinePaidCents={props.onlinePaidCents}
            balanceCents={props.balanceCents}
          />
        )}
        {tab === "questions" && (
          <p className="cust-empty">
            No booking questions yet — questions aren&apos;t collected during checkout. Ask for this feature when you
            need it.
          </p>
        )}
      </div>
    </>
  );
}

function PurchasesTab({ purchases }: { purchases: PurchaseLine[] }) {
  return purchases.length === 0 ? (
    <p className="cust-empty">No items on this booking.</p>
  ) : (
    <>
      {purchases.map((p, i) => (
        <div className="cust-purchase" key={i}>
          {p.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="cust-thumb" src={p.imageUrl} alt="" />
          ) : (
            <RoomBadge name={p.roomName} bg={p.badgeBg} fg={p.badgeFg} />
          )}
          <div className="cust-purchase-main">
            <span className="cust-purchase-name">{p.roomName}</span>
            <div className="cust-purchase-sub">
              {p.when} · {p.duration}
            </div>
          </div>
          <div className="cust-purchase-qty">
            <span className="k">Quantity</span>×{p.quantity}
          </div>
          <div className="cust-purchase-amt">
            <span className="k">Amount</span>
            {formatMoney(p.amountCents)}
          </div>
        </div>
      ))}
    </>
  );
}

// Shared submit helper: POST/DELETE json, surface the API's error message.
async function call(url: string, init: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return (data as { error?: string }).error ?? "Something went wrong. Please try again.";
    return null;
  } catch {
    return "Could not reach the server. Check your connection and try again.";
  }
}

function PromosTab({
  bookingId,
  promoCode,
  discountCents,
  activePromos,
}: {
  bookingId: string;
  promoCode: string | null;
  discountCents: number;
  activePromos: { code: string; percentOff: number }[];
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (!code) return setError("Choose a promo code to apply.");
    setBusy(true);
    setError(null);
    const err = await call(`/api/manager/bookings/${bookingId}/promo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (err) setError(err);
    else {
      setCode("");
      router.refresh();
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const err = await call(`/api/manager/bookings/${bookingId}/promo`, { method: "DELETE" });
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <>
      {promoCode ? (
        <div className="bk-row">
          <div className="bk-row-main">
            <span className="mgr-pill on">{promoCode}</span>
            <span style={{ marginLeft: 10 }}>−{formatMoney(discountCents)} off this booking</span>
          </div>
          <button type="button" className="mgr-linklike danger" onClick={remove} disabled={busy}>
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      ) : (
        <div className="bk-add">
          <h3>Apply a promotion</h3>
          <p className="card-sub">Discount is recalculated on the whole booking; the amount already paid stays put.</p>
          {activePromos.length === 0 ? (
            <p className="cust-empty">
              No active promo codes. <Link href="/manager/promos">Create one in Promo codes</Link>.
            </p>
          ) : (
            <div className="mgr-inline-form">
              <div className="field" style={{ minWidth: 240 }}>
                <label>Discount code</label>
                <SingleSelect
                  value={code}
                  onChange={setCode}
                  ariaLabel="Choose a discount code"
                  options={[
                    { value: "", label: "Choose a code…" },
                    ...activePromos.map((p) => ({ value: p.code, label: `${p.code} — ${p.percentOff}% off` })),
                  ]}
                />
              </div>
              <button type="button" className="btn" onClick={apply} disabled={busy}>
                {busy ? "Applying…" : "Apply"}
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p className="field-error" style={{ marginTop: 10 }}>{error}</p>}
      <p className="cust-empty" style={{ marginTop: 14 }}>
        Gift vouchers aren&apos;t set up yet — promo codes only for now.
      </p>
    </>
  );
}

function CustomersTab({
  bookingId,
  customerName,
  customerEmail,
  participants,
}: {
  bookingId: string;
  customerName: string;
  customerEmail: string;
  participants: Participant[];
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initials = (a: string, b: string) => `${a.charAt(0)}${b.charAt(0)}`.toUpperCase() || "?";
  const nameParts = customerName.split(" ");

  async function add() {
    setBusy(true);
    setError(null);
    const err = await call(`/api/manager/bookings/${bookingId}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, email }),
    });
    setBusy(false);
    if (err) setError(err);
    else {
      setFirstName("");
      setLastName("");
      setEmail("");
      router.refresh();
    }
  }

  async function remove(pid: string) {
    setBusy(true);
    setError(null);
    const err = await call(`/api/manager/bookings/${bookingId}/participants?pid=${encodeURIComponent(pid)}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <>
      <div className="bk-row">
        <span className="cust-activity-avatar" aria-hidden="true">
          {initials(nameParts[0] ?? "", nameParts[1] ?? "")}
        </span>
        <div className="bk-row-main">
          <Link href={`/manager/customers/${encodeURIComponent(customerEmail)}`} className="cust-purchase-name">
            {customerName}
          </Link>
          <div className="cust-purchase-sub">
            {customerEmail} · Primary customer
          </div>
        </div>
      </div>

      {participants.map((p) => (
        <div className="bk-row" key={p.id}>
          <span className="cust-activity-avatar" aria-hidden="true">
            {initials(p.firstName, p.lastName)}
          </span>
          <div className="bk-row-main">
            <span className="cust-purchase-name">
              {p.firstName} {p.lastName}
            </span>
            <div className="cust-purchase-sub">{p.email ?? "No email"} · Participant</div>
          </div>
          <button type="button" className="mgr-linklike danger" onClick={() => remove(p.id)} disabled={busy}>
            Remove
          </button>
        </div>
      ))}

      <div className="bk-add">
        <h3>Add participant</h3>
        <div className="mgr-inline-form">
          <div className="field">
            <label htmlFor="bk-pfirst">First name</label>
            <input id="bk-pfirst" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="bk-plast">Last name</label>
            <input id="bk-plast" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="bk-pemail">Email (optional)</label>
            <input id="bk-pemail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button type="button" className="btn" onClick={add} disabled={busy}>
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
        {error && <p className="field-error" style={{ marginTop: 10 }}>{error}</p>}
      </div>
    </>
  );
}

function TaxesTab({
  taxes,
  gstCents,
  appliedTo,
}: {
  taxes: { name: string; percent: number }[];
  gstCents: number;
  appliedTo: string;
}) {
  if (gstCents <= 0 && taxes.length === 0) {
    return <p className="cust-empty">No taxes or fees on this booking.</p>;
  }
  // Split the booking's tax amount across active taxes by rate; remainder on the last.
  const totalPercent = taxes.reduce((s, t) => s + t.percent, 0);
  const rows =
    taxes.length > 0
      ? taxes.map((t, i) => ({
          name: t.name,
          percent: t.percent,
          amountCents:
            i === taxes.length - 1
              ? gstCents - taxes.slice(0, -1).reduce((s, x) => s + Math.round((gstCents * x.percent) / totalPercent), 0)
              : Math.round((gstCents * t.percent) / totalPercent),
        }))
      : [{ name: "Tax", percent: 0, amountCents: gstCents }];

  return (
    <>
      {rows.map((r, i) => (
        <div className="cust-purchase" key={i}>
          <div className="cust-purchase-main">
            <span className="cust-purchase-name">{r.name}</span>
            <div className="cust-purchase-sub">
              Type: Tax{r.percent > 0 ? ` · Rate: ${r.percent}%` : ""}
              <br />
              Applied to: {appliedTo}
            </div>
          </div>
          <div className="cust-purchase-amt">
            <span className="k">Amount</span>
            {formatMoney(r.amountCents)}
          </div>
        </div>
      ))}
    </>
  );
}

function PaymentsTab({
  bookingId,
  payments,
  onlinePaidCents,
  balanceCents,
}: {
  bookingId: string;
  payments: BookingPayment[];
  onlinePaidCents: number;
  balanceCents: number;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<BookingPayment["method"]>("cash");
  const [amount, setAmount] = useState((balanceCents / 100).toFixed(2));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return setError("Enter a payment amount greater than zero.");
    }
    setBusy(true);
    setError(null);
    const err = await call(`/api/manager/bookings/${bookingId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, amountCents, note }),
    });
    setBusy(false);
    if (err) setError(err);
    else {
      setNote("");
      router.refresh();
    }
  }

  async function remove(pid: string) {
    setBusy(true);
    setError(null);
    const err = await call(`/api/manager/bookings/${bookingId}/payments?pid=${encodeURIComponent(pid)}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <>
      {onlinePaidCents > 0 && (
        <div className="bk-row">
          <div className="bk-row-main">
            <span className="cust-purchase-name">Online at booking</span>
            <div className="cust-purchase-sub">Collected during checkout</div>
          </div>
          <strong>{formatMoney(onlinePaidCents)}</strong>
        </div>
      )}
      {payments.map((p) => (
        <div className="bk-row" key={p.id}>
          <div className="bk-row-main">
            <span className="cust-purchase-name">{METHOD_LABEL[p.method]}</span>
            <div className="cust-purchase-sub">
              {fmtWhen(p.at)}
              {p.note ? ` · ${p.note}` : ""}
            </div>
          </div>
          <strong>{formatMoney(p.amountCents)}</strong>
          <button type="button" className="mgr-linklike danger" onClick={() => remove(p.id)} disabled={busy}>
            Remove
          </button>
        </div>
      ))}
      {onlinePaidCents <= 0 && payments.length === 0 && <p className="cust-empty">No payments recorded yet.</p>}

      {balanceCents > 0 ? (
        <div className="bk-add">
          <h3>Record a payment</h3>
          <p className="card-sub">
            Bookkeeping only — log money already taken in cash or on your card terminal. No card is charged here.
          </p>
          <div className="mgr-inline-form">
            <div className="field" style={{ minWidth: 160 }}>
              <label>Method</label>
              <SingleSelect
                value={method}
                onChange={(v) => setMethod(v as BookingPayment["method"])}
                ariaLabel="How the payment was taken"
                options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))}
              />
            </div>
            <div className="field">
              <label htmlFor="bk-amount">Amount ($)</label>
              <input
                id="bk-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ width: 110 }}
              />
            </div>
            <div className="field">
              <label htmlFor="bk-note">Note (optional)</label>
              <input id="bk-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <button type="button" className="btn" onClick={add} disabled={busy}>
              {busy ? "Recording…" : "Record payment"}
            </button>
          </div>
          {error && <p className="field-error" style={{ marginTop: 10 }}>{error}</p>}
        </div>
      ) : (
        <p className="cust-empty" style={{ marginTop: 10 }}>
          Paid in full — nothing left to collect.
        </p>
      )}
    </>
  );
}
