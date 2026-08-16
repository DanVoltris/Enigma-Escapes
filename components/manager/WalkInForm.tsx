"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import SingleSelect from "@/components/SingleSelect";
import { addDaysISO, formatMoney, formatTime, todayISO } from "@/lib/format";
import { BOOKING_WINDOW_DAYS } from "@/lib/pricing";

// Staff can book walk-ins of any size; the 4-person minimum is customer-only.
const WALK_IN_MIN = 1;

type Exp = { id: string; name: string; location: string; priceCents: number; capacity: number; times: string[] };
type KnownCustomer = { firstName: string; lastName: string; email: string; phone: string };

// One room on the booking. A group often takes two — same reference, one total,
// one payment — so this is a list rather than a single room/date/time.
// `key` only exists to keep React rows stable while they're being edited.
type Session = { key: number; roomId: string; date: string; time: string; quantity: number };

// onRoomChange lets the page react to the chosen experience — the on-shift
// panel above the form uses it to highlight who can run that room.
export default function WalkInForm({ onRoomChange }: { onRoomChange?: (roomId: string) => void } = {}) {
  const router = useRouter();
  const today = todayISO();

  // Room lists are per-date: a room runs different hours on a Friday than a
  // Sunday, so each session's date gets its own fetch, cached by date.
  const [expByDate, setExpByDate] = useState<Record<string, Exp[]>>({});
  const [sessions, setSessions] = useState<Session[]>([
    { key: 1, roomId: "", date: today, time: "", quantity: 2 },
  ]);
  const nextKey = useRef(2);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // No deposit option at the desk — taken out on request. The customer-facing
  // checkout still offers one, so nothing changes for online bookings.
  const [paymentOption, setPaymentOption] = useState<"full" | "none">("full");
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

  // Every date in play gets its room list fetched once and kept. Stale
  // responses are ignored, so stepping through dates can't leave one day's
  // times sitting under another day's rooms.
  const dates = sessions.map((x) => x.date).join(",");
  useEffect(() => {
    let current = true;
    const wanted = [...new Set(dates.split(",").filter(Boolean))];
    for (const d of wanted) {
      if (expByDate[d]) continue;
      fetch(`/api/manager/experiences/list?date=${encodeURIComponent(d)}`)
        .then((r) => r.json())
        .then((res) => {
          if (!current) return;
          setExpByDate((prev) => ({ ...prev, [d]: (res.experiences ?? []) as Exp[] }));
        })
        .catch(() => {
          if (current) setError("Could not load experiences. Reload the page.");
        });
    }
    return () => {
      current = false;
    };
  }, [dates, expByDate]);

  const roomsFor = (d: string): Exp[] => expByDate[d] ?? [];
  const expFor = (x: Session): Exp | undefined => roomsFor(x.date).find((e) => e.id === x.roomId);

  // Fill in a room and a time as soon as the list for that date arrives, and
  // correct any time that doesn't exist on the newly chosen day.
  useEffect(() => {
    setSessions((prev) => {
      let touched = false;
      const next = prev.map((x) => {
        const list = expByDate[x.date];
        if (!list || list.length === 0) return x;
        const room = list.find((e) => e.id === x.roomId) ?? list[0];
        const time = room.times.includes(x.time) ? x.time : (room.times[0] ?? "");
        if (room.id === x.roomId && time === x.time) return x;
        touched = true;
        return { ...x, roomId: room.id, time };
      });
      return touched ? next : prev;
    });
    // Also runs when a row's date or room changes, not just when a new date's
    // list lands — otherwise switching to a date already fetched leaves the old
    // day's time sitting there. Returning `prev` untouched makes this a no-op,
    // so there's no loop.
  }, [expByDate, sessions]);

  // The on-shift panel above highlights whoever can run the first room.
  const leadRoom = sessions[0]?.roomId;
  useEffect(() => {
    if (leadRoom) onRoomChange?.(leadRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callback is the caller's, not a trigger
  }, [leadRoom]);

  const update = (key: number, patch: Partial<Session>) =>
    setSessions((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const addSession = () => {
    const last = sessions[sessions.length - 1];
    const date = last?.date ?? today;
    // Seeded from the last row — a second room is nearly always the same day for
    // the same group — and defaulted to a room they haven't already got, since
    // the same room twice at the same time is the one thing they can't have.
    const used = new Set(sessions.filter((x) => x.date === date).map((x) => x.roomId));
    const list = expByDate[date] ?? [];
    const room = list.find((e) => !used.has(e.id)) ?? list[0];
    setSessions((prev) => [
      ...prev,
      {
        key: nextKey.current++,
        roomId: room?.id ?? "",
        date,
        time: room?.times[0] ?? "",
        quantity: last?.quantity ?? 2,
      },
    ]);
  };

  const removeSession = (key: number) => setSessions((prev) => prev.filter((x) => x.key !== key));

  const subtotal = sessions.reduce((sum, x) => {
    const exp = expFor(x);
    return sum + (exp ? exp.priceCents * x.quantity : 0);
  }, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    for (const x of sessions) {
      const exp = expFor(x);
      if (!exp) return setError("Pick an experience for every room on this booking.");
      if (!x.time) return setError(`Pick a start time for ${exp.name}.`);
      if (x.quantity > exp.capacity) return setError(`Capacity for ${exp.name} is ${exp.capacity}.`);
    }
    // The same room twice at the same time is one slot sold twice, and the
    // server sees two separate items rather than a clash — so it's caught here.
    const slots = sessions.map((x) => `${x.roomId}|${x.date}|${x.time}`);
    const duplicate = slots.find((slot, i) => slots.indexOf(slot) !== i);
    if (duplicate) {
      const exp = expFor(sessions.find((x) => `${x.roomId}|${x.date}|${x.time}` === duplicate)!);
      return setError(`${exp?.name ?? "That room"} is on this booking twice at the same time.`);
    }

    setSaving(true);
    try {
      const res = await fetch("/api/manager/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: sessions.map((x) => ({ roomId: x.roomId, date: x.date, time: x.time, quantity: x.quantity })),
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

      <h3>{sessions.length > 1 ? "Rooms" : "Session"}</h3>
      {sessions.map((x, i) => {
        const exp = expFor(x);
        const rooms = roomsFor(x.date);
        return (
          <div key={x.key} className={sessions.length > 1 ? "walkin-session" : undefined}>
            {sessions.length > 1 && (
              <div className="walkin-session-head">
                <strong>Room {i + 1}</strong>
                <button type="button" className="mgr-linklike danger" onClick={() => removeSession(x.key)}>
                  Remove
                </button>
              </div>
            )}
            <div className="field-row">
              <div className="field">
                <label>Experience</label>
                <SingleSelect
                  ariaLabel={`Experience for room ${i + 1}`}
                  value={x.roomId}
                  onChange={(v) => update(x.key, { roomId: v })}
                  options={rooms.map((e) => ({ value: e.id, label: `${e.name} — ${e.location}` }))}
                />
              </div>
              <div className="field">
                <label>Time</label>
                <SingleSelect
                  ariaLabel={`Time for room ${i + 1}`}
                  value={x.time}
                  onChange={(v) => update(x.key, { time: v })}
                  options={(exp?.times ?? []).map((t) => ({ value: t, label: formatTime(t) }))}
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Date</label>
                <DatePicker
                  value={x.date}
                  min={today}
                  max={addDaysISO(today, BOOKING_WINDOW_DAYS)}
                  onChange={(v) => update(x.key, { date: v })}
                />
              </div>
              <div className="field">
                <label>Guests</label>
                <div className="stepper">
                  <button
                    type="button"
                    onClick={() => update(x.key, { quantity: Math.max(WALK_IN_MIN, x.quantity - 1) })}
                    disabled={x.quantity <= WALK_IN_MIN}
                    aria-label={`Fewer guests in room ${i + 1}`}
                  >
                    −
                  </button>
                  <span className="value">{x.quantity}</span>
                  <button
                    type="button"
                    onClick={() => update(x.key, { quantity: Math.min(exp?.capacity ?? x.quantity, x.quantity + 1) })}
                    disabled={!!exp && x.quantity >= exp.capacity}
                    aria-label={`More guests in room ${i + 1}`}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Guests are counted per room, not shared: two rooms at the same time is
          two teams racing, and they are rarely the same size. */}
      <div className="vch-save" style={{ marginTop: 4, marginBottom: 20 }}>
        <button type="button" className="btn btn-outline" onClick={addSession}>
          + Add another room
        </button>
        {sessions.length > 1 && (
          <span className="sub">One booking, one reference, one payment — guests counted per room.</span>
        )}
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
        <label className={`pay-option ${paymentOption === "none" ? "selected" : ""}`}>
          <input type="radio" checked={paymentOption === "none"} onChange={() => setPaymentOption("none")} />
          <span>Nothing yet — the whole amount is owed</span>
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
