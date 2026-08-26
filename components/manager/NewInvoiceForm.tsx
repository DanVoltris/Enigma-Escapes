"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/format";

type Room = { id: string; name: string; location: string; priceCents: number };

type Line = {
  key: string;
  roomId: string;
  roomName: string;
  location: string;
  date: string;
  time: string;
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
  return { key: Math.random().toString(36).slice(2), roomId: "", roomName: "", location: "", date: "", time: "", quantity: "1", price: "" };
}

function toCents(dollars: string): number {
  const n = Number(String(dollars).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export default function NewInvoiceForm({
  experiences,
  taxPercent,
  taxLabel,
}: {
  experiences: Room[];
  taxPercent: number;
  taxLabel: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const subtotalCents = lines.reduce((n, l) => n + toCents(l.price) * (Number(l.quantity) || 0), 0);
    const discountCents = Math.min(Math.max(0, toCents(discount)), subtotalCents);
    const taxable = subtotalCents - discountCents;
    const taxCents = Math.round((taxable * taxPercent) / 100);
    return { subtotalCents, discountCents, taxCents, totalCents: taxable + taxCents };
  }, [lines, discount, taxPercent]);

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
    setLine(key, {
      roomId: r.id,
      roomName: r.name,
      location: r.location,
      price: (r.priceCents / 100).toFixed(2),
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
                <label htmlFor={`${uid}-room-${i}`}>Room or item</label>
                <select id={`${uid}-room-${i}`} value={l.roomId} onChange={(e) => pickRoom(l.key, e.target.value)}>
                  <option value="">Type your own…</option>
                  {experiences.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} — {e.location}
                    </option>
                  ))}
                </select>
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
                <label htmlFor={`${uid}-date-${i}`}>Date (optional)</label>
                <input id={`${uid}-date-${i}`} type="date" value={l.date} onChange={(e) => setLine(l.key, { date: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`${uid}-time-${i}`}>Time (optional)</label>
                <input id={`${uid}-time-${i}`} type="time" value={l.time} onChange={(e) => setLine(l.key, { time: e.target.value })} />
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
        <h2>Totals and terms</h2>
        <div className="mgr-form">
          <div className="field-row-3">
            <div className="field">
              <label htmlFor="inv-discount">Discount (optional)</label>
              <input type="text" id="inv-discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="field">
              <label htmlFor="inv-expires">Valid until (optional)</label>
              <input id="inv-expires" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="inv-note">Note on the invoice (optional)</label>
            <textarea id="inv-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Payment terms, purchase order number, anything the customer needs to see." />
          </div>

          <table className="inv-totals">
            <tbody>
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
