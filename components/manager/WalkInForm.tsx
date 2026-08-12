"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import SingleSelect from "@/components/SingleSelect";
import { addDaysISO, formatMoney, formatTime, todayISO } from "@/lib/format";
import { BOOKING_WINDOW_DAYS } from "@/lib/pricing";

// Staff can book walk-ins of any size; the 4-person minimum is customer-only.
const WALK_IN_MIN = 1;

type Exp = { id: string; name: string; location: string; priceCents: number; capacity: number; times: string[] };
type KnownCustomer = { firstName: string; lastName: string; email: string; phone: string };

// onRoomChange lets the page react to the chosen experience — the on-shift
// panel above the form uses it to highlight who can run that room.
export default function WalkInForm({ onRoomChange }: { onRoomChange?: (roomId: string) => void } = {}) {
  const router = useRouter();
  const today = todayISO();

  const [experiences, setExperiences] = useState<Exp[]>([]);
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [quantity, setQuantity] = useState(2);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentOption, setPaymentOption] = useState<"full" | "deposit">("full");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Customer lookup: typing 2+ characters in ANY customer field (name, email,
  // phone) suggests known customers; picking one fills all four fields.
  // Suppressed right after a pick until they type again.
  type LookupField = "firstName" | "lastName" | "email" | "phone";
  const [suggestions, setSuggestions] = useState<KnownCustomer[]>([]);
  const [lookupField, setLookupField] = useState<LookupField | null>(null);
  const [justPicked, setJustPicked] = useState(false);
  const fieldValues: Record<LookupField, string> = { firstName, lastName, email, phone };
  const lookupQuery = lookupField ? fieldValues[lookupField].trim() : "";

  useEffect(() => {
    if (!lookupField || lookupQuery.length < 2 || justPicked) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/manager/customers/search?q=${encodeURIComponent(lookupQuery)}`)
        .then((r) => r.json())
        .then((d) => setSuggestions((d.customers ?? []) as KnownCustomer[]))
        .catch(() => setSuggestions([]));
    }, 200);
    return () => clearTimeout(t);
  }, [lookupQuery, lookupField, justPicked]);

  function pickCustomer(c: KnownCustomer) {
    setFirstName(c.firstName);
    setLastName(c.lastName);
    setEmail(c.email);
    setPhone(c.phone);
    setJustPicked(true);
    setLookupField(null);
    setSuggestions([]);
  }

  // Shared props for a lookup-enabled input, plus the dropdown it anchors.
  const lookupProps = (field: LookupField, setter: (v: string) => void) => ({
    autoComplete: "off" as const,
    "aria-autocomplete": "list" as const,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(e.target.value);
      setLookupField(field);
      setJustPicked(false);
    },
    onFocus: () => setLookupField(field),
    onBlur: () => setTimeout(() => setLookupField((f) => (f === field ? null : f)), 150),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") setLookupField(null);
    },
  });
  const lookupList = (field: LookupField) =>
    lookupField === field && suggestions.length > 0 ? (
      <ul className="cust-lookup-list" role="listbox" aria-label="Known customers">
        {suggestions.map((c) => (
          <li key={c.email}>
            <button type="button" role="option" aria-selected="false" onMouseDown={() => pickCustomer(c)}>
              <strong>
                {c.firstName} {c.lastName}
              </strong>
              <span className="sub">
                {c.email}
                {c.phone ? ` · ${c.phone}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  useEffect(() => {
    fetch("/api/manager/experiences/list")
      .then((r) => r.json())
      .then((d) => {
        const list: Exp[] = d.experiences ?? [];
        setExperiences(list);
        if (list[0]) {
          setRoomId(list[0].id);
          setTime(list[0].times[0] ?? "");
          // The form defaults to the first experience, so tell the page too —
          // otherwise the panel above shows nothing highlighted while the
          // dropdown clearly has a room selected.
          onRoomChange?.(list[0].id);
        }
      })
      .catch(() => setError("Could not load experiences. Reload the page."));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
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
            onChange={(v) => {
              setRoomId(v);
              onRoomChange?.(v);
            }}
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
          <label>Guests</label>
          <div className="stepper">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(WALK_IN_MIN, q - 1))}
              disabled={quantity <= WALK_IN_MIN}
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
        <div className="field cust-lookup">
          <label htmlFor="fn">First name</label>
          <input id="fn" type="text" value={firstName} {...lookupProps("firstName", setFirstName)} />
          {lookupList("firstName")}
        </div>
        <div className="field cust-lookup">
          <label htmlFor="ln">Last name</label>
          <input id="ln" type="text" value={lastName} {...lookupProps("lastName", setLastName)} />
          {lookupList("lastName")}
        </div>
      </div>
      <div className="field-row">
        <div className="field cust-lookup">
          <label htmlFor="em">Email</label>
          <input id="em" type="email" value={email} {...lookupProps("email", setEmail)} />
          {lookupList("email")}
        </div>
        <div className="field cust-lookup">
          <label htmlFor="ph">Phone</label>
          <input id="ph" type="tel" value={phone} {...lookupProps("phone", setPhone)} />
          {lookupList("phone")}
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
          <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-secondary)" }}> + tax</span>
        </span>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Saving…" : "Create booking"}
        </button>
      </div>
    </form>
  );
}
