"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import SingleSelect from "@/components/SingleSelect";
import { addDaysISO, formatMoney, formatTime, todayISO } from "@/lib/format";
import { BOOKING_WINDOW_DAYS, MIN_PARTY_SIZE } from "@/lib/pricing";

type Exp = { id: string; name: string; location: string; priceCents: number; capacity: number; times: string[] };

export default function WalkInForm() {
  const router = useRouter();
  const today = todayISO();

  const [experiences, setExperiences] = useState<Exp[]>([]);
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [quantity, setQuantity] = useState(MIN_PARTY_SIZE);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentOption, setPaymentOption] = useState<"full" | "deposit">("full");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/manager/experiences/list")
      .then((r) => r.json())
      .then((d) => {
        const list: Exp[] = d.experiences ?? [];
        setExperiences(list);
        if (list[0]) {
          setRoomId(list[0].id);
          setTime(list[0].times[0] ?? "");
        }
      })
      .catch(() => setError("Could not load experiences. Reload the page."));
  }, []);

  const selected = useMemo(() => experiences.find((e) => e.id === roomId), [experiences, roomId]);

  // Keep the selected time valid whenever the experience changes.
  useEffect(() => {
    if (selected && !selected.times.includes(time)) setTime(selected.times[0] ?? "");
  }, [selected, time]);

  const subtotal = selected ? selected.priceCents * quantity : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selected) return setError("Pick an experience.");
    if (quantity > selected.capacity) return setError(`Capacity for ${selected.name} is ${selected.capacity}.`);

    setSaving(true);
    try {
      const res = await fetch("/api/manager/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ roomId, date, time, quantity }],
          customer: { firstName, lastName, email, phone, subscribe: false },
          paymentOption,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save the booking.");
      router.push(`/manager/bookings/${data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the booking.");
      setSaving(false);
    }
  }

  return (
    <form className="form-card mgr-form" onSubmit={submit} noValidate>
      {error && <div className="error-banner">{error}</div>}

      <h3>Session</h3>
      <div className="field-row">
        <div className="field">
          <label>Experience</label>
          <SingleSelect
            ariaLabel="Experience"
            value={roomId}
            onChange={setRoomId}
            options={experiences.map((e) => ({ value: e.id, label: `${e.name} — ${e.location}` }))}
          />
        </div>
        <div className="field">
          <label>Time</label>
          <SingleSelect
            ariaLabel="Time"
            value={time}
            onChange={setTime}
            options={(selected?.times ?? []).map((t) => ({ value: t, label: formatTime(t) }))}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Date</label>
          <DatePicker value={date} min={today} max={addDaysISO(today, BOOKING_WINDOW_DAYS)} onChange={setDate} />
        </div>
        <div className="field">
          <label>Guests (min {MIN_PARTY_SIZE})</label>
          <div className="stepper">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(MIN_PARTY_SIZE, q - 1))}
              disabled={quantity <= MIN_PARTY_SIZE}
              aria-label="Fewer guests"
            >
              −
            </button>
            <span className="value">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(selected?.capacity ?? q, q + 1))}
              disabled={!!selected && quantity >= selected.capacity}
              aria-label="More guests"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <h3>Customer</h3>
      <div className="field-row">
        <div className="field">
          <label htmlFor="fn">First name</label>
          <input id="fn" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ln">Last name</label>
          <input id="ln" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="em">Email</label>
          <input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ph">Phone</label>
          <input id="ph" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>

      <h3>Payment</h3>
      <div className="pay-options">
        <label className={`pay-option ${paymentOption === "full" ? "selected" : ""}`}>
          <input type="radio" checked={paymentOption === "full"} onChange={() => setPaymentOption("full")} />
          <span>Paid in full at the desk</span>
        </label>
        <label className={`pay-option ${paymentOption === "deposit" ? "selected" : ""}`}>
          <input type="radio" checked={paymentOption === "deposit"} onChange={() => setPaymentOption("deposit")} />
          <span>Deposit only (25%) — balance due later</span>
        </label>
      </div>

      <div className="form-actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span className="panel-subtotal">
          Subtotal <span className="amount">{formatMoney(subtotal)}</span>
          <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-secondary)" }}> + GST</span>
        </span>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Saving…" : "Create booking"}
        </button>
      </div>
    </form>
  );
}
