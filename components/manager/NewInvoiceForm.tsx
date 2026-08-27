"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import SingleSelect from "@/components/SingleSelect";
import { formatMoney, formatTime, todayISO } from "@/lib/format";

type Room = { id: string; name: string; location: string; priceCents: number; times: string[] };

// Marks the "type your own" choice in the time dropdown. Not a time, so it can
// never collide with one.
const CUSTOM = "__custom";

// Rooms in interval or window mode publish no explicit starts, and a hand-typed
// line has no room at all — both fall back to a plain half-hourly list rather
// than leaving staff with nothing to pick.
const FALLBACK_TIMES = Array.from({ length: 29 }, (_, i) => {
  const mins = 9 * 60 + i * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${mins % 60 === 0 ? "00" : "30"}`;
});

type Line = {
  key: string;
  roomId: string;
  roomName: string;
  location: string;
  date: string;
  time: string;
  timeCustom: boolean; // typing a time the room doesn't publish
  quantity: string;
  price: string; // dollars, as typed
};

// A line can be a room off the list or something typed by hand — corporate
// quotes routinely carry a catering charge or a room hire that isn't a game.
//
// `key` is random and never rendered; the ids below come from useId() and the
// row's position instead. A random value in an id attribute renders differently
// on the server than on the client, which is a hydration mismatch.
function blankLine(): Line {
  return {
    key: Math.random().toString(36).slice(2),
    roomId: "", roomName: "", location: "", date: "", time: "", timeCustom: false,
    quantity: "1", price: "",
  };
}

function toCents(dollars: string): number {
  const n = Number(String(dollars).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export default function NewInvoiceForm({
  experiences,
  taxPercent,
  taxLabel,
  defaultFeeCents,
}: {
  experiences: Room[];
  taxPercent: number;
  taxLabel: string;
  defaultFeeCents: number;
}) {
  const router = useRouter();
  const uid = useId();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [corporate, setCorporate] = useState(false);
  const [fee, setFee] = useState((defaultFeeCents / 100).toFixed(2));
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const roomsCents = lines.reduce((n, l) => n + toCents(l.price) * (Number(l.quantity) || 0), 0);
    const flatFeeCents = corporate ? toCents(fee) : 0;
    const subtotalCents = roomsCents + flatFeeCents;
    const discountCents = Math.min(Math.max(0, toCents(discount)), subtotalCents);
    const taxable = subtotalCents - discountCents;
    const taxCents = Math.round((taxable * taxPercent) / 100);
    return { roomsCents, flatFeeCents, subtotalCents, discountCents, taxCents, totalCents: taxable + taxCents };
  }, [lines, discount, taxPercent, corporate, fee]);

  // A room's published starts when one is picked, the half-hourly fallback
  // otherwise. A custom time already typed is kept in the list so it survives
  // switching back and forth.
  function timesFor(l: Line): string[] {
    const room = experiences.find((e) => e.id === l.roomId);
    const base = room && room.times.length > 0 ? room.times : FALLBACK_TIMES;
    return l.time && !base.includes(l.time) ? [...base, l.time].sort() : base;
  }

  function setLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  // Picking a room fills the name, venue and its current price; all three stay
  // editable, because a quoted price is often not the list price.
  function pickRoom(key: string, roomId: string) {
    const r = experiences.find((e) => e.id === roomId);
    if (!r) {
      setLine(key, { roomId: "", roomName: "", location: "" });
      return;
    }
    const line = lines.find((l) => l.key === key);
    // Keep a chosen time only if this room actually runs it; otherwise it
    // becomes a custom time rather than silently pointing at a session that
    // doesn't exist.
    const keepsTime = !line?.time || line.timeCustom || r.times.includes(line.time);
    setLine(key, {
      roomId: r.id,
      roomName: r.name,
      location: r.location,
      price: (r.priceCents / 100).toFixed(2),
      timeCustom: line?.time ? !r.times.includes(line.time) : false,
      time: keepsTime ? line?.time ?? "" : "",
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      customer: { name: name.trim(), email: email.trim(), phone: phone.trim(), company: company.trim() },
      lines: lines
        .filter((l) => l.roomName.trim())
        .map((l) => ({
          roomName: l.roomName.trim(),
          location: l.location.trim(),
          date: l.date || null,
          time: l.time || null,
          quantity: Number(l.quantity) || 1,
          unitCents: toCents(l.price),
        })),
      discountCents: toCents(discount),
      taxPercent,
      corporate,
      flatFeeCents: corporate ? toCents(fee) : 0,
      note: note.trim(),
      expiresOn: expiresOn || null,
    };
    try {
      const res = await fetch("/api/manager/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error || "Could not save the invoice.");
        setBusy(false);
        return;
      }
      router.push("/manager/invoices");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 18 }}>
      <div className="mgr-card">
        <h2>Who it&apos;s for</h2>
        <div className="mgr-form">
          <div className="field-row-3">
            <div className="field">
              <label htmlFor="inv-name">Contact name</label>
              <input type="text" id="inv-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="inv-company">Company (optional)</label>
              <input type="text" id="inv-company" value={company} onChange={(e) => setCompany(e.target.value)} />
              <p className="field-hint">Billed to this name when given.</p>
            </div>
            <div className="field">
              <label htmlFor="inv-email">Email</label>
              <input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </div>
          <div className="field" style={{ maxWidth: 260 }}>
            <label htmlFor="inv-phone">Phone (optional)</label>
            <input type="text" id="inv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="mgr-card" style={{ marginTop: 18 }}>
        <h2>What they&apos;re being billed for</h2>
        <div className="mgr-form">
          {lines.map((l, i) => (
            <div key={l.key} className="inv-line">
              <div className="field">
                <label id={`${uid}-roomlbl-${i}`}>Room or item</label>
                <SingleSelect
                  ariaLabel="Room or item"
                  value={l.roomId}
                  onChange={(v) => pickRoom(l.key, v)}
                  options={[
                    // Leaving it unselected still allows a hand-typed line —
                    // catering, room hire — but the dropdown shouldn't advertise
                    // that as if it were the normal thing to do.
                    { value: "", label: "Select room" },
                    ...experiences.map((e) => ({ value: e.id, label: `${e.name} — ${e.location}` })),
                  ]}
                />
              </div>
              <div className="field">
                <label htmlFor={`${uid}-desc-${i}`}>Description</label>
                <input type="text"
                  id={`${uid}-desc-${i}`}
                  value={l.roomName}
                  onChange={(e) => setLine(l.key, { roomName: e.target.value })}
                  placeholder="e.g. Shady Grove Sanatorium"
                />
              </div>
              <div className="field">
                <label id={`${uid}-datelbl-${i}`}>Date (optional)</label>
                <DatePicker
                  value={l.date || todayISO()}
                  min="2000-01-01"
                  max="2100-12-31"
                  onChange={(v) => setLine(l.key, { date: v })}
                />
                {l.date && (
                  <button type="button" className="link-button" onClick={() => setLine(l.key, { date: "" })}>
                    Clear date
                  </button>
                )}
              </div>
              <div className="field">
                <label id={`${uid}-timelbl-${i}`}>Time (optional)</label>
                {l.timeCustom ? (
                  <input
                    type="text"
                    value={l.time}
                    onChange={(e) => setLine(l.key, { time: e.target.value })}
                    placeholder="18:30"
                    aria-label="Custom time, 24-hour"
                  />
                ) : (
                  <SingleSelect
                    ariaLabel="Session time"
                    value={l.time}
                    onChange={(v) =>
                      v === CUSTOM
                        ? setLine(l.key, { timeCustom: true, time: "" })
                        : setLine(l.key, { time: v })
                    }
                    options={[
                      { value: "", label: "No time" },
                      ...timesFor(l).map((t) => ({ value: t, label: formatTime(t) })),
                      { value: CUSTOM, label: "Custom time…" },
                    ]}
                  />
                )}
                {l.timeCustom && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setLine(l.key, { timeCustom: false, time: "" })}
                  >
                    Pick from the list
                  </button>
                )}
              </div>
              <div className="field inv-narrow">
                <label htmlFor={`${uid}-qty-${i}`}>Qty</label>
                <input type="text"
                  id={`${uid}-qty-${i}`}
                  inputMode="numeric"
                  value={l.quantity}
                  onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                />
              </div>
              <div className="field inv-narrow">
                <label htmlFor={`${uid}-price-${i}`}>Price each</label>
                <input type="text"
                  id={`${uid}-price-${i}`}
                  inputMode="decimal"
                  value={l.price}
                  onChange={(e) => setLine(l.key, { price: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="inv-line-total">
                <span className="sub">Line</span>
                <strong>{formatMoney(toCents(l.price) * (Number(l.quantity) || 0))}</strong>
              </div>
              {lines.length > 1 && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  aria-label={`Remove line ${i + 1}`}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-outline" onClick={() => setLines((ls) => [...ls, blankLine()])}>
            + Add another line
          </button>
        </div>
      </div>

      <div className="mgr-card" style={{ marginTop: 18 }}>
        <h2>Corporate event</h2>
        <p className="card-sub">
          Team building away from the rooms, a host, then the games. One fee for the whole invoice
          however many rooms it covers — the rooms themselves stay at their per-person price above.
        </p>
        <div className="mgr-form">
          <label className="intg-toggle">
            <input type="checkbox" checked={corporate} onChange={(e) => setCorporate(e.target.checked)} />
            This is a corporate event
          </label>
          {corporate && (
            <div className="field" style={{ maxWidth: 260 }}>
              <label htmlFor="inv-fee">Event fee</label>
              <input type="text" id="inv-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
              <p className="field-hint">
                Appears as its own line on the invoice. Any discount below comes off it too, the same
                as it would on a booking.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mgr-card" style={{ marginTop: 18 }}>
        <h2>Totals and terms</h2>
        <div className="mgr-form">
          <div className="field-row-3">
            <div className="field">
              <label htmlFor="inv-discount">Discount (optional)</label>
              <input type="text" id="inv-discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="field">
              <label id="inv-expireslbl">Valid until (optional)</label>
              <DatePicker
                value={expiresOn || todayISO()}
                min="2000-01-01"
                max="2100-12-31"
                onChange={setExpiresOn}
              />
              {expiresOn && (
                <button type="button" className="link-button" onClick={() => setExpiresOn("")}>
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="field">
            <label htmlFor="inv-note">Note on the invoice (optional)</label>
            <textarea id="inv-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Payment terms, purchase order number, anything the customer needs to see." />
          </div>

          <table className="inv-totals">
            <tbody>
              <tr><td>Rooms</td><td className="num">{formatMoney(totals.roomsCents)}</td></tr>
              {totals.flatFeeCents > 0 && (
                <tr><td>Event fee</td><td className="num">{formatMoney(totals.flatFeeCents)}</td></tr>
              )}
              <tr><td>Subtotal</td><td className="num">{formatMoney(totals.subtotalCents)}</td></tr>
              {totals.discountCents > 0 && (
                <tr><td>Discount</td><td className="num">-{formatMoney(totals.discountCents)}</td></tr>
              )}
              <tr><td>{taxLabel} ({taxPercent}%)</td><td className="num">{formatMoney(totals.taxCents)}</td></tr>
              <tr className="inv-grand"><td>Total</td><td className="num">{formatMoney(totals.totalCents)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {error && <p className="field-error" style={{ marginTop: 14 }}>{error}</p>}

      <div className="mgr-actions-row" style={{ marginTop: 18 }}>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Saving…" : "Save invoice"}
        </button>
        <p className="sub" style={{ margin: 0 }}>
          Saving doesn&apos;t email anything — you send it from the list when you&apos;re ready.
        </p>
      </div>
    </form>
  );
}
