"use client";

import { useEffect, useState } from "react";
import SendReceipt from "./SendReceipt";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RoomBadge from "@/components/RoomBadge";
import SingleSelect from "@/components/SingleSelect";
import RefundPanel from "@/components/manager/RefundPanel";
import { formatMoney, formatTimestamp } from "@/lib/format";
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
  chargedQuantity?: number; // set when a smaller party is billed at the venue's minimum
  amountCents: number;
};

type Props = {
  emailReady: boolean; // whether RESEND_API_KEY / EMAIL_FROM are set
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
  voucherCode: string | null;
  voucherPaidCents: number;
  cancelled: boolean;
};

type TabKey = "purchases" | "promos" | "customers" | "taxes" | "payments" | "questions";

const METHOD_LABEL = PAYMENT_METHOD_LABEL;

function fmtWhen(iso: string): string {
  return formatTimestamp(iso);
}

export default function BookingTabs(props: Props) {
  const [tab, setTab] = useState<TabKey>("purchases");
  const paymentCount =
    (props.onlinePaidCents > 0 ? 1 : 0) + (props.voucherPaidCents > 0 ? 1 : 0) + props.payments.length;

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
        {/* Sits after Questions, at the far end of the row. */}
        <SendReceipt
          bookingId={props.bookingId}
          defaultEmail={props.customerEmail || ""}
          ready={props.emailReady}
        />
      </div>

      <div className="cust-tabpanel">
        {tab === "purchases" && <PurchasesTab purchases={props.purchases} />}
        {tab === "promos" && (
          <PromosTab
            bookingId={props.bookingId}
            promoCode={props.promoCode}
            discountCents={props.discountCents}
            activePromos={props.activePromos}
            voucherCode={props.voucherCode}
            voucherPaidCents={props.voucherPaidCents}
            balanceCents={props.balanceCents}
            cancelled={props.cancelled}
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
            voucherCode={props.voucherCode}
            voucherPaidCents={props.voucherPaidCents}
            cancelled={props.cancelled}
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
            {p.chargedQuantity && p.chargedQuantity > p.quantity && (
              <span className="sub">{` (charged for ${p.chargedQuantity})`}</span>
            )}
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

type VoucherHit = { code: string; faceCents: number; remainingCents: number; purchaser: string | null };

// What's left on a voucher, as a share of what it was worth.
function VoucherMeter({ v }: { v: VoucherHit }) {
  const pct = v.faceCents > 0 ? Math.min(100, Math.round((v.remainingCents / v.faceCents) * 100)) : 0;
  return (
    <div className="mgr-meter" title={`${pct}% left`} style={{ marginTop: 6 }}>
      <div className="fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function PromosTab({
  bookingId,
  promoCode,
  discountCents,
  activePromos,
  voucherCode,
  voucherPaidCents,
  balanceCents,
  cancelled,
}: {
  bookingId: string;
  promoCode: string | null;
  discountCents: number;
  activePromos: { code: string; percentOff: number }[];
  voucherCode: string | null;
  voucherPaidCents: number;
  balanceCents: number;
  cancelled: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [giftCode, setGiftCode] = useState("");
  const [giftAmount, setGiftAmount] = useState((balanceCents / 100).toFixed(2));
  const [giftError, setGiftError] = useState<string | null>(null);
  // Type-ahead: two or more characters list the spendable codes containing
  // them. Picking one (or typing a code out in full) shows its balance and
  // fills the amount with as much of it as the booking can take.
  const [giftHits, setGiftHits] = useState<VoucherHit[]>([]);
  const [giftListOpen, setGiftListOpen] = useState(false);
  const [picked, setPicked] = useState<VoucherHit | null>(null);
  const giftQuery = giftCode.trim();

  useEffect(() => {
    if (giftQuery.length < 2 || picked?.code === giftQuery) {
      setGiftHits([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/manager/bookings/${bookingId}/voucher?q=${encodeURIComponent(giftQuery)}`)
        .then((r) => r.json())
        .then((d) => {
          const hits = (d.vouchers ?? []) as VoucherHit[];
          setGiftHits(hits);
          const exact = hits.find((h) => h.code === giftQuery);
          if (exact) pickVoucher(exact);
        })
        .catch(() => setGiftHits([]));
    }, 200);
    return () => clearTimeout(t);
    // pickVoucher only reads balanceCents, which a refresh would also re-run this for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giftQuery, bookingId, picked?.code]);

  // The most the voucher can put towards this booking: what's owed, or what's
  // left on the card if that's less. A $100 card on a $90 booking stops at $90.
  const giftMaxCents = Math.min(balanceCents, picked?.remainingCents ?? balanceCents);

  function changeGiftAmount(value: string) {
    const cents = Math.round(Number(value) * 100);
    setGiftAmount(Number.isFinite(cents) && cents > giftMaxCents ? (giftMaxCents / 100).toFixed(2) : value);
  }

  function pickVoucher(v: VoucherHit) {
    setPicked(v);
    setGiftCode(v.code);
    setGiftHits([]);
    setGiftListOpen(false);
    setGiftAmount((Math.min(v.remainingCents, balanceCents) / 100).toFixed(2));
    setGiftError(null);
  }
  // Applying a promo refreshes the page with a new balance; keep the voucher
  // amount box in step with it (same trick as the Payments tab).
  const [filledFor, setFilledFor] = useState(balanceCents);
  if (filledFor !== balanceCents) {
    setFilledFor(balanceCents);
    setGiftAmount((balanceCents / 100).toFixed(2));
  }

  async function applyVoucher() {
    const trimmed = giftCode.trim();
    if (!trimmed) return setGiftError("Enter the gift voucher code.");
    const amountCents = Math.round(Number(giftAmount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return setGiftError("Enter an amount greater than zero.");
    }
    if (amountCents > giftMaxCents) {
      return setGiftError(`The most this voucher can pay here is ${formatMoney(giftMaxCents)}.`);
    }
    setBusy(true);
    setGiftError(null);
    const err = await call(`/api/manager/bookings/${bookingId}/voucher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: trimmed, amountCents }),
    });
    setBusy(false);
    if (err) setGiftError(err);
    else {
      setGiftCode("");
      setPicked(null);
      router.refresh();
    }
  }

  async function removeVoucher() {
    setBusy(true);
    setGiftError(null);
    const err = await call(`/api/manager/bookings/${bookingId}/voucher`, { method: "DELETE" });
    setBusy(false);
    if (err) setGiftError(err);
    else router.refresh();
  }

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

      {voucherCode ? (
        <div className="bk-row" style={{ marginTop: 14 }}>
          <div className="bk-row-main">
            <span className="mgr-pill on">{voucherCode}</span>
            <span style={{ marginLeft: 10 }}>
              {voucherPaidCents > 0
                ? `gift voucher — ${formatMoney(voucherPaidCents)} paid towards this booking`
                : "gift voucher — taken once the booking is paid"}
            </span>
          </div>
          {!cancelled && (
            <button type="button" className="mgr-linklike danger" onClick={removeVoucher} disabled={busy}>
              {busy ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
      ) : cancelled ? null : balanceCents <= 0 ? (
        <p className="cust-empty" style={{ marginTop: 14 }}>
          Nothing is owed on this booking, so there&apos;s nothing for a gift voucher to pay.
        </p>
      ) : (
        <div className="bk-add" style={{ marginTop: 14 }}>
          <h3>Apply a gift voucher</h3>
          <p className="card-sub">
            The amount comes off the voucher&apos;s balance now and counts as paid. It goes back on the voucher if
            the booking is cancelled.
          </p>
          <div className="mgr-inline-form">
            <div className="field cust-lookup" style={{ minWidth: 260 }}>
              <label htmlFor="bk-gift-code">Voucher code</label>
              <input
                id="bk-gift-code"
                type="text"
                autoComplete="off"
                aria-autocomplete="list"
                spellCheck={false}
                value={giftCode}
                onChange={(e) => {
                  setGiftCode(e.target.value.toUpperCase());
                  setPicked(null);
                  setGiftListOpen(true);
                }}
                onFocus={() => setGiftListOpen(true)}
                onBlur={() => setTimeout(() => setGiftListOpen(false), 150)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setGiftListOpen(false);
                  if (e.key === "Enter" && giftHits.length > 0) {
                    e.preventDefault();
                    pickVoucher(giftHits[0]);
                  }
                }}
                placeholder="Start typing a code…"
              />
              {giftListOpen && giftHits.length > 0 && (
                <ul className="cust-lookup-list" role="listbox" aria-label="Gift vouchers">
                  {giftHits.map((v) => (
                    <li key={v.code}>
                      <button type="button" role="option" aria-selected="false" onMouseDown={() => pickVoucher(v)}>
                        <strong>{v.code}</strong>
                        <span className="sub">
                          {formatMoney(v.remainingCents)} left of {formatMoney(v.faceCents)}
                          {v.purchaser ? ` · ${v.purchaser}` : ""}
                        </span>
                        <VoucherMeter v={v} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="field">
              <label htmlFor="bk-gift-amount">Amount ($)</label>
              <input
                id="bk-gift-amount"
                type="number"
                min="0.01"
                max={(giftMaxCents / 100).toFixed(2)}
                step="0.01"
                value={giftAmount}
                onChange={(e) => changeGiftAmount(e.target.value)}
                style={{ width: 110 }}
              />
            </div>
            <button type="button" className="btn" onClick={applyVoucher} disabled={busy}>
              {busy ? "Applying…" : "Apply voucher"}
            </button>
          </div>
          {picked && (
            <div style={{ marginTop: 12, maxWidth: 420 }}>
              <p style={{ margin: "0 0 6px" }}>
                <strong>{formatMoney(picked.remainingCents)}</strong> left on {picked.code}, of{" "}
                {formatMoney(picked.faceCents)} originally
                {picked.purchaser ? ` · ${picked.purchaser}` : ""}
              </p>
              <VoucherMeter v={picked} />
              {(() => {
                const usingCents = Math.round(Number(giftAmount) * 100);
                if (!Number.isFinite(usingCents) || usingCents <= 0) return null;
                const leftCents = Math.max(0, picked.remainingCents - Math.min(usingCents, giftMaxCents));
                return (
                  <p style={{ margin: "8px 0 0" }}>
                    Using {formatMoney(Math.min(usingCents, giftMaxCents))} leaves{" "}
                    <strong>{formatMoney(leftCents)}</strong> on the voucher.
                  </p>
                );
              })()}
            </div>
          )}
        </div>
      )}
      {giftError && <p className="field-error" style={{ marginTop: 10 }}>{giftError}</p>}
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
  voucherCode,
  voucherPaidCents,
  cancelled,
}: {
  bookingId: string;
  payments: BookingPayment[];
  onlinePaidCents: number;
  balanceCents: number;
  voucherCode: string | null;
  voucherPaidCents: number;
  cancelled: boolean;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<BookingPayment["method"]>("cash");
  const [amount, setAmount] = useState((balanceCents / 100).toFixed(2));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Recording a payment refreshes the page with a smaller balance, but useState
  // keeps the figure it started with — so re-fill the box with what's actually
  // left. Otherwise staff see the amount they just took and record it twice.
  const [filledFor, setFilledFor] = useState(balanceCents);
  if (filledFor !== balanceCents) {
    setFilledFor(balanceCents);
    setAmount((balanceCents / 100).toFixed(2));
  }

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
      {voucherPaidCents > 0 && (
        <div className="bk-row">
          <div className="bk-row-main">
            <span className="cust-purchase-name">Gift voucher</span>
            <div className="cust-purchase-sub">
              {voucherCode} — comes back on the voucher if this booking is cancelled
            </div>
          </div>
          <strong>{formatMoney(voucherPaidCents)}</strong>
        </div>
      )}
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
      {onlinePaidCents <= 0 && voucherPaidCents <= 0 && payments.length === 0 && (
        <p className="cust-empty">No payments recorded yet.</p>
      )}

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
      ) : cancelled ? (
        <p className="cust-empty" style={{ marginTop: 10 }}>
          This booking is cancelled — there is nothing to collect. Money already taken goes back
          through Refund below.
        </p>
      ) : (
        <p className="cust-empty" style={{ marginTop: 10 }}>
          Paid in full — nothing left to collect.
        </p>
      )}

      {/* Giving money back lives with the money, not in the sidebar. */}
      <div className="bk-add" style={{ marginTop: 16 }}>
        <h3>Refund</h3>
        <p className="card-sub">
          Send money back to the card it came from, in part or in full. The booking stays as it is.
        </p>
        <RefundPanel bookingId={bookingId} />
      </div>
    </>
  );
}
