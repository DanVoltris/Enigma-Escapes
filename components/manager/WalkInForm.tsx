"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import SingleSelect from "@/components/SingleSelect";
import { addDaysISO, formatDateLong, formatMoney, formatTime, todayISO } from "@/lib/format";
import { CORPORATE_FEE_CENTS, CORPORATE_LEAD_IN_MINUTES } from "@/lib/pricing";
import { minutesOfTime, minutesToTime } from "@/lib/capacity";
import { BOOKING_WINDOW_DAYS } from "@/lib/pricing";

// Staff can book walk-ins of any size; the 4-person minimum is customer-only.
const WALK_IN_MIN = 1;

type Exp = { id: string; name: string; location: string; priceCents: number; capacity: number; times: string[] };
type KnownCustomer = { firstName: string; lastName: string; email: string; phone: string };

// One room on the booking. A group often takes two — same reference, one total,
// one payment — so this is a list rather than a single room/date/time.
// `key` only exists to keep React rows stable while they're being edited.
type Session = {
  key: number;
  roomId: string;
  date: string;
  time: string;
  quantity: number;
  // Set once someone gives this room a date of its own. Until then it follows
  // the first room, because a group taking two rooms is coming on one visit.
  ownDate?: boolean;
};

// Sessions left on a day that has passed move to the new today; the time is
// cleared with them because the new day runs a different schedule. Exported so
// the rollover can be checked without waiting for midnight.
export function rollForward(sessions: Session[], today: string): Session[] {
  return sessions.map((x) => (x.date < today ? { ...x, date: today, time: "" } : x));
}

// onRoomChange lets the page react to the chosen experience — the on-shift
// panel above the form uses it to highlight who can run that room.
export default function WalkInForm({ onRoomChange }: { onRoomChange?: (roomId: string) => void } = {}) {
  const router = useRouter();
  // Live, not frozen at page load. The desk leaves this form open, and a form
  // opened at 11:55 PM was still offering yesterday when submitted at 12:05 AM —
  // the server rejects the date as past, which reads as the form breaking.
  const [today, setToday] = useState(todayISO());

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
  //
  // Defaults to nothing taken: the money is usually collected after the booking
  // is made, and a default of "paid in full" quietly writes off a payment
  // nobody made. Owing money that has been paid is a question at the desk;
  // being marked paid when you haven't is a loss that never gets noticed.
  const [paymentOption, setPaymentOption] = useState<"full" | "none">("none");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rolledOver, setRolledOver] = useState(false);
  // A corporate event: one fee for the booking, the rooms at their usual price,
  // and the group arriving early for team building somewhere other than a room.
  const [corporate, setCorporate] = useState(false);
  const [leadIn, setLeadIn] = useState(String(CORPORATE_LEAD_IN_MINUTES));
  // Off-grid start, allowed only for corporate events. Empty = use the room's
  // published times as normal.
  const [customTime, setCustomTime] = useState("");
  // What the desk actually chose in the date picker, per row. Kept so a date
  // that changes by any other route can be caught before the booking is made
  // rather than discovered afterwards.
  const pickedDates = useRef<Record<number, string>>({});

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

  // Watch for the venue day rolling over while the form sits open. Anything
  // still pointing at a day that has now passed is moved forward — leaving it
  // would only fail at the point of saving, after the customer's details have
  // been typed in.
  useEffect(() => {
    const tick = setInterval(() => {
      const now = todayISO();
      setToday((was) => {
        if (was === now) return was;
        setSessions((prev) => rollForward(prev, now));
        setRolledOver(true);
        return now;
      });
    }, 60_000);
    return () => clearInterval(tick);
  }, []);

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
        // A corporate event sets its own time and isn't held to the room's
        // published starts, so leave it alone — snapping it back to the grid
        // was silently undoing the time the desk had just typed.
        const time = corporate
          ? x.time
          : room.times.includes(x.time)
            ? x.time
            : (room.times[0] ?? "");
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
  }, [expByDate, sessions, corporate]);

  // The on-shift panel above highlights whoever can run the first room.
  const leadRoom = sessions[0]?.roomId;
  useEffect(() => {
    if (leadRoom) onRoomChange?.(leadRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callback is the caller's, not a trigger
  }, [leadRoom]);

  const update = (key: number, patch: Partial<Session>) =>
    setSessions((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  // Rooms follow the first one's date until one is deliberately moved.
  //
  // The second room is seeded with the first one's date, so changing only the
  // row you clicked left the other quietly sitting on today and half the
  // booking was made for the wrong day. Matching on the old date instead was
  // worse — every row matches at the start, so nothing could ever be separated.
  const changeDate = (key: number, next: string) => {
    pickedDates.current[key] = next;
    setSessions((prev) => {
      const first = prev[0];
      const movingFirst = first?.key === key;
      return prev.map((x) => {
        if (x.key === key) return { ...x, date: next, ownDate: movingFirst ? x.ownDate : true };
        // The rest follow only when the first room moves, and only while they
        // haven't been given a date of their own.
        // Rows dragged along by the first one count as chosen too — the desk
        // moved them on purpose, just with one click.
        if (movingFirst && !x.ownDate) {
          pickedDates.current[x.key] = next;
          return { ...x, date: next };
        }
        return x;
      });
    });
  };

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
        // Every room of a corporate event runs at the one time the event does.
        time: corporate ? (last?.time ?? "") : (room?.times[0] ?? ""),
        quantity: last?.quantity ?? 2,
      },
    ]);
  };

  const removeSession = (key: number) => setSessions((prev) => prev.filter((x) => x.key !== key));

  const roomsTotal = sessions.reduce((sum, x) => {
    const exp = expFor(x);
    return sum + (exp ? exp.priceCents * x.quantity : 0);
  }, 0);
  // The fee is charged once for the booking, however many rooms it holds.
  const subtotal = roomsTotal + (corporate ? CORPORATE_FEE_CENTS : 0);

  // Corporate events run all their rooms at one time, so a single start time
  // governs the booking — the desk picks rooms, not a time per room.
  const applyTimeToAll = (time: string) =>
    setSessions((prev) => prev.map((x) => ({ ...x, time })));

  // When the group is expected, counted back from the rooms' start.
  const arrivesAt = (() => {
    const start = sessions[0]?.time;
    const mins = Number(leadIn);
    if (!corporate || !start || !Number.isFinite(mins) || mins <= 0) return "";
    return minutesToTime(minutesOfTime(start) - mins);
  })();

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

    // A date that isn't the one that was picked means something moved it, and
    // the desk is one click from booking the wrong day. Caught here rather than
    // trusted: this has been reported happening and the cause isn't found yet.
    const drifted = sessions.find(
      (x) => pickedDates.current[x.key] && pickedDates.current[x.key] !== x.date
    );
    if (drifted) {
      const chose = pickedDates.current[drifted.key];
      pickedDates.current = {};
      setSessions((prev) => prev.map((x) => (x.key === drifted.key ? { ...x, date: chose } : x)));
      return setError(
        `This booking was about to be made for ${formatDateLong(drifted.date)}, but ${formatDateLong(chose)} ` +
          `was chosen. The date has been put back — check it and press Create booking again.`
      );
    }

    setSaving(true);
    try {
      const res = await fetch("/api/manager/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: sessions.map((x) => ({ roomId: x.roomId, date: x.date, time: x.time, quantity: x.quantity })),
          ...(corporate ? { corporate: true, leadInMinutes: Number(leadIn) || 0 } : {}),
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
      {rolledOver && (
        <div className="card-sub" style={{ color: "var(--danger)" }}>
          It&apos;s past midnight — this booking has been moved to {formatDateLong(today)}. Check the
          date and time before saving.
        </div>
      )}

      <label className="checkbox-row" style={{ marginBottom: 14 }}>
        <input
          type="checkbox"
          checked={corporate}
          onChange={(e) => {
            setCorporate(e.target.checked);
            if (!e.target.checked) setCustomTime("");
          }}
        />
        <span>
          Corporate event — {formatMoney(CORPORATE_FEE_CENTS)} plus the rooms, with team building
          first
        </span>
      </label>

      {corporate && (
        <div className="mgr-inline-form" style={{ marginBottom: 14 }}>
          <div className="field" style={{ maxWidth: 150 }}>
            <label htmlFor="corp-time">Rooms start at</label>
            <input
              id="corp-time"
              type="time"
              value={customTime || sessions[0]?.time || ""}
              onChange={(e) => {
                setCustomTime(e.target.value);
                applyTimeToAll(e.target.value);
              }}
            />
            <p className="field-hint">Any time — a corporate event isn&apos;t held to the grid.</p>
          </div>
          <div className="field" style={{ maxWidth: 150 }}>
            <label htmlFor="corp-lead">Team building (min)</label>
            <input
              id="corp-lead"
              type="number"
              min="0"
              max="240"
              step="5"
              value={leadIn}
              onChange={(e) => setLeadIn(e.target.value)}
            />
            <p className="field-hint">
              {arrivesAt ? `Group arrives ${formatTime(arrivesAt)}` : "No room needed for this part"}
            </p>
          </div>
        </div>
      )}

      <h3>{corporate ? "Rooms" : sessions.length > 1 ? "Rooms" : "Session"}</h3>
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
                {corporate ? (
                  // One time governs the whole event, set above. The dropdown is
                  // built from the room's published starts, so an off-grid
                  // corporate time has nothing to select and the row would sit
                  // there showing a time it wasn't going to book.
                  <p className="sub" style={{ margin: "10px 0 0" }}>
                    {x.time ? formatTime(x.time) : "—"} · set for the whole event
                  </p>
                ) : (
                  <SingleSelect
                    ariaLabel={`Time for room ${i + 1}`}
                    value={x.time}
                    onChange={(v) => update(x.key, { time: v })}
                    options={(exp?.times ?? []).map((t) => ({ value: t, label: formatTime(t) }))}
                  />
                )}
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Date</label>
                <DatePicker
                  value={x.date}
                  min={today}
                  max={addDaysISO(today, BOOKING_WINDOW_DAYS)}
                  onChange={(v) => changeDate(x.key, v)}
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
          {corporate && (
            <span className="walkin-when" style={{ marginTop: 0, marginBottom: 4 }}>
              <span>
                Rooms {formatMoney(roomsTotal)} + corporate fee {formatMoney(CORPORATE_FEE_CENTS)}
              </span>
            </span>
          )}
          Subtotal <span className="amount">{formatMoney(subtotal)}</span>
          <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-secondary)" }}> + tax</span>
          {/* The date and time in plain sight at the moment of pressing, so a
              wrong day can't go through unread. */}
          <span className="walkin-when">
            {corporate && arrivesAt && (
              <span>Team building from {formatTime(arrivesAt)} — no room needed</span>
            )}
            {sessions.map((x) => (
              <span key={x.key}>
                {expFor(x)?.name ?? "—"} · {formatDateLong(x.date)}
                {x.time ? ` · ${formatTime(x.time)}` : ""}
              </span>
            ))}
          </span>
        </span>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Saving…" : "Create booking"}
        </button>
      </div>
    </form>
  );
}
