"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DateJump from "@/components/manager/DateJump";
import RoomBadge from "@/components/RoomBadge";
import SingleSelect from "@/components/SingleSelect";
import { addDaysISO, formatMoney, formatTime } from "@/lib/format";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS, splitEvenly } from "@/lib/payment-methods";
import type { PaymentMethod } from "@/lib/types";

export type TodayRow = {
  bookingId: string;
  reference: string;
  time: string;
  roomName: string;
  location: string;
  durationMinutes: number;
  quantity: number;
  badgeBg: string;
  badgeFg: string;
  customerName: string;
  phone: string;
  email: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  refundOwedCents: number; // money taken beyond the total, still to give back
  payments: { id: string; method: PaymentMethod; amountCents: number; payer: string | null }[];
  noShow: boolean;
  source: string;
};

type Line = { key: number; method: PaymentMethod; amount: string; payer: string };

let lineKey = 0;
const newLine = (method: PaymentMethod, amountCents: number, payer = ""): Line => ({
  key: lineKey++,
  method,
  amount: (amountCents / 100).toFixed(2),
  payer,
});

export default function TodayBoard({
  terminalReady,
  canSetUpTerminal,
  rows,
  date,
  isToday,
  dateLabel,
  nowMinutes,
  locations,
  loc,
}: {
  terminalReady: boolean; // a card reader is paired for this venue
  canSetUpTerminal: boolean; // may configure it — only they see the setup hint
  rows: TodayRow[];
  date: string;
  isToday: boolean;
  dateLabel: string;
  nowMinutes: number;
  locations: string[]; // the venues this staff member may see
  loc: string | null; // the one being shown, or null for all of them
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);

  const guests = rows.reduce((s, r) => s + r.quantity, 0);

  return (
    <>
      <div className="mgr-actions-row" style={{ marginBottom: 6 }}>
        <h1 className="mgr-page-title" style={{ marginBottom: 0 }}>
          {isToday ? "Today" : dateLabel}
        </h1>
        <div className="day-nav spaced">
          <Link href={`/manager/today?date=${addDaysISO(date, -1)}${loc ? `&loc=${encodeURIComponent(loc)}` : ""}`} className="btn btn-outline">
            ‹ Day
          </Link>
          <DateJump date={date} basePath="/manager/today" />
          <Link href={`/manager/today?date=${addDaysISO(date, 1)}${loc ? `&loc=${encodeURIComponent(loc)}` : ""}`} className="btn btn-outline">
            Day ›
          </Link>
        </div>
      </div>
      <p className="mgr-page-sub">
        {rows.length === 0
          ? "Nobody booked in."
          : `${rows.length} session${rows.length === 1 ? "" : "s"} · ${guests} guest${guests === 1 ? "" : "s"}`}
        {loc && ` · ${loc}`}
      </p>

      {/* Only worth showing when there's more than one venue to choose between.
          The day carries across, so switching venue keeps you on the same date. */}
      {locations.length > 1 && (
        <div className="mgr-list-tools" style={{ marginBottom: 14 }}>
          <span>
            <Link
              href={`/manager/today?date=${date}`}
              className={loc === null ? "mgr-pill on" : "mgr-pill"}
              aria-current={loc === null ? "true" : undefined}
            >
              All locations
            </Link>
            {locations.map((l) => (
              <Link
                key={l}
                href={`/manager/today?date=${date}&loc=${encodeURIComponent(l)}`}
                className={loc === l ? "mgr-pill on" : "mgr-pill"}
                aria-current={loc === l ? "true" : undefined}
                style={{ marginLeft: 8 }}
              >
                {l}
              </Link>
            ))}
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="mgr-empty">No bookings for this day{loc ? ` at ${loc}` : ""}.</p>
      ) : (
        <div className="today-list">
          {rows.map((r) => {
            const [h, m] = r.time.split(":").map(Number);
            const past = isToday && h * 60 + m < nowMinutes;
            const open = openId === r.bookingId;
            return (
              <div className={`today-row${past ? " past" : ""}${open ? " open" : ""}`} key={`${r.bookingId}-${r.time}`}>
                <button
                  type="button"
                  className="today-head"
                  onClick={() => setOpenId(open ? null : r.bookingId)}
                  aria-expanded={open}
                >
                  <span className="today-time">{formatTime(r.time)}</span>
                  <RoomBadge name={r.roomName} bg={r.badgeBg} fg={r.badgeFg} />
                  <span className="today-what">
                    <span className="today-room">{r.roomName}</span>
                    <span className="sub">
                      {r.location} · {r.quantity} guest{r.quantity === 1 ? "" : "s"} · {r.durationMinutes} min
                    </span>
                  </span>
                  <span className="today-who">
                    <span>{r.customerName}</span>
                    <span className="sub">{r.reference}</span>
                  </span>
                  <span className="today-money">
                    {r.balanceCents > 0 ? (
                      <span className="mgr-pill" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                        {formatMoney(r.balanceCents)} due
                      </span>
                    ) : r.refundOwedCents > 0 ? (
                      // Overpaid. "Paid" would be true but useless here — the
                      // desk needs to know money has to go back.
                      <span className="mgr-pill" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                        Refund {formatMoney(r.refundOwedCents)}
                      </span>
                    ) : (
                      <span className="mgr-pill on">Paid</span>
                    )}
                    {r.noShow && <span className="mgr-pill">No-show</span>}
                  </span>
                  <span className="today-caret" aria-hidden="true">
                    {open ? "▴" : "▾"}
                  </span>
                </button>

                {open && (
                  <div className="today-detail">
                    <div className="today-contact">
                      <div>
                        <span className="req-label">Contact</span>{" "}
                        <a href={`tel:${r.phone}`}>{r.phone}</a> · <a href={`mailto:${r.email}`}>{r.email}</a>
                      </div>
                      <div>
                        <span className="req-label">Total</span> {formatMoney(r.totalCents)} ·{" "}
                        <span className="req-label">Paid</span> {formatMoney(r.paidCents)}
                        {r.balanceCents > 0 && (
                          <>
                            {" "}
                            · <span className="req-label">Due</span>{" "}
                            <strong style={{ color: "var(--danger)" }}>{formatMoney(r.balanceCents)}</strong>
                          </>
                        )}
                      </div>
                      {r.payments.length > 0 && (
                        <div className="today-paid-list">
                          {r.payments.map((p) => (
                            <span className="mgr-pill" key={p.id}>
                              {formatMoney(p.amountCents)} {PAYMENT_METHOD_LABEL[p.method]}
                              {p.payer ? ` · ${p.payer}` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                      <div>
                        <Link href={`/manager/bookings/${r.bookingId}`}>Open full booking →</Link>
                      </div>
                    </div>

                    {r.balanceCents > 0 ? (
                      <TakePayment
                        terminalReady={terminalReady}
                        canSetUpTerminal={canSetUpTerminal}
                        bookingId={r.bookingId}
                        balanceCents={r.balanceCents}
                        guests={r.quantity}
                        customerName={r.customerName}
                        onDone={() => {
                          setOpenId(null);
                          router.refresh();
                        }}
                      />
                    ) : (
                      <p className="mgr-empty" style={{ margin: 0 }}>
                        Fully paid — nothing to collect.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// Split-payment builder: one line per payer/method. Start with the whole
// balance on the terminal, or split it evenly between the guests, then adjust.
function TakePayment({
  terminalReady,
  canSetUpTerminal,
  bookingId,
  balanceCents,
  guests,
  customerName,
  onDone,
}: {
  terminalReady: boolean;
  canSetUpTerminal: boolean;
  bookingId: string;
  balanceCents: number;
  guests: number;
  customerName: string;
  onDone: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([newLine("card", balanceCents, customerName)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live card-reader charge: null when idle, otherwise the payment in flight.
  const [onReader, setOnReader] = useState<{ intentId: string; readerId: string; cents: number } | null>(null);
  const [readerNote, setReaderNote] = useState<string | null>(null);

  // Sends one line's amount to the reader at this venue and waits for the tap.
  async function chargeOnReader(line: Line) {
    const cents = Math.round((Number(line.amount) || 0) * 100);
    if (cents <= 0) {
      setError("Enter an amount first.");
      return;
    }
    setBusy(true);
    setError(null);
    setReaderNote("Waking the reader…");
    try {
      const res = await fetch("/api/manager/terminal/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, amountCents: cents, payer: line.payer.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error ?? "Could not reach the reader.");
      setOnReader({ intentId: d.intentId, readerId: d.readerId, cents });
      setReaderNote("Waiting for the customer to tap…");
      poll(d.intentId as string, line.payer.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the reader.");
      setReaderNote(null);
      setBusy(false);
    }
  }

  // Poll until Stripe reports the tap. The server records the payment itself
  // (once), so a slow network here can never double-charge anyone.
  function poll(intentId: string, payer: string) {
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const res = await fetch(
          `/api/manager/terminal/status?intent=${encodeURIComponent(intentId)}&booking=${encodeURIComponent(
            bookingId
          )}&payer=${encodeURIComponent(payer)}`
        );
        const d = await res.json().catch(() => ({}));
        if (d.status === "succeeded" && d.recorded) {
          setReaderNote("Paid — thank you!");
          setOnReader(null);
          setBusy(false);
          onDone();
          return;
        }
        if (d.error) setReaderNote(`Reader says: ${d.error}`);
        if (tries > 150) {
          // ~5 minutes: stop nagging Stripe and hand control back to staff.
          setReaderNote("The reader timed out — cancel and try again.");
          setBusy(false);
          return;
        }
        setTimeout(tick, 2000);
      } catch {
        setTimeout(tick, 2000);
      }
    };
    setTimeout(tick, 2000);
  }

  async function cancelReader() {
    if (!onReader) return;
    await fetch("/api/manager/terminal/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readerId: onReader.readerId, intentId: onReader.intentId }),
    }).catch(() => {});
    setOnReader(null);
    setReaderNote(null);
    setBusy(false);
  }

  const enteredCents = lines.reduce((s, l) => s + Math.round((Number(l.amount) || 0) * 100), 0);
  const remaining = balanceCents - enteredCents;

  function set(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function splitBetween(ways: number) {
    const parts = splitEvenly(balanceCents, ways);
    setLines(parts.map((cents, i) => newLine("card", cents, i === 0 ? customerName : `Guest ${i + 1}`)));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = lines
        .map((l) => ({
          method: l.method,
          amountCents: Math.round((Number(l.amount) || 0) * 100),
          payer: l.payer.trim(),
        }))
        .filter((l) => l.amountCents > 0);
      if (payload.length === 0) throw new Error("Enter at least one amount.");
      const res = await fetch(`/api/manager/bookings/${bookingId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payments: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not record that.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="today-pay">
      <div className="today-pay-head">
        <strong>Take payment — {formatMoney(balanceCents)} due</strong>
        <span className="today-split-buttons">
          <span className="sub">Split:</span>
          <button type="button" className="link-button" onClick={() => setLines([newLine("card", balanceCents, customerName)])}>
            one payer
          </button>
          {guests > 1 && (
            <button type="button" className="link-button" onClick={() => splitBetween(guests)}>
              {guests} guests evenly
            </button>
          )}
          <button type="button" className="link-button" onClick={() => splitBetween(2)}>
            in half
          </button>
        </span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="today-pay-lines">
        {lines.map((l, i) => (
          <div className="today-pay-line" key={l.key}>
            <input
              type="text"
              value={l.payer}
              onChange={(e) => set(l.key, { payer: e.target.value })}
              placeholder={`Payer ${i + 1}`}
              aria-label="Who is paying"
            />
            <SingleSelect
              ariaLabel="Payment method"
              value={l.method}
              onChange={(v) => set(l.key, { method: v as PaymentMethod })}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))}
            />
            <div className="today-amount">
              <span>$</span>
              <input
                type="text"
                inputMode="decimal"
                value={l.amount}
                onChange={(e) => set(l.key, { amount: e.target.value.replace(/[^\d.]/g, "") })}
                aria-label="Amount"
              />
            </div>
            {/* Card lines can go straight to the reader instead of being typed
                into a separate machine and recorded by hand. */}
            {l.method === "card" && terminalReady && !onReader && (
              <button type="button" className="link-button" onClick={() => chargeOnReader(l)} disabled={busy}>
                Send to terminal
              </button>
            )}
            {lines.length > 1 && (
              <button
                type="button"
                className="chk-remove"
                aria-label="Remove this payment"
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {(onReader || readerNote) && (
        <div className="today-reader">
          <span>
            {onReader ? <strong>{formatMoney(onReader.cents)} on the reader</strong> : null} {readerNote}
          </span>
          {onReader && (
            <button type="button" className="link-button danger" onClick={cancelReader}>
              Cancel
            </button>
          )}
        </div>
      )}

      <div className="today-pay-foot">
        <button
          type="button"
          className="link-button"
          onClick={() => setLines((ls) => [...ls, newLine("cash", Math.max(0, remaining))])}
        >
          + Add another payer
        </button>
        {!terminalReady && canSetUpTerminal && (
          <span className="sub">
            Card reader not set up —{" "}
            <Link href="/manager/settings/payments">pair one in Settings → Payments</Link>
          </span>
        )}
        <span className={remaining === 0 ? "sub" : "field-error"}>
          {remaining === 0
            ? "Adds up exactly"
            : remaining > 0
              ? `${formatMoney(remaining)} still unallocated`
              : `${formatMoney(-remaining)} over the amount due`}
        </span>
        <button type="button" className="btn" onClick={submit} disabled={busy || enteredCents <= 0 || remaining < 0}>
          {busy ? "Recording…" : `Record ${formatMoney(enteredCents)}`}
        </button>
      </div>
    </div>
  );
}
