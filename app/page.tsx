"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import ProgressSteps from "@/components/ProgressSteps";
import RoomBadge from "@/components/RoomBadge";
import SelectMenu, { type SelectItem } from "@/components/SelectMenu";
import { itemKey, useCart } from "@/lib/cart";
import {
  addDaysISO,
  dateBadgeParts,
  formatDateLong,
  formatMoney,
  formatTime,
  todayISO,
} from "@/lib/format";
import { BOOKING_WINDOW_DAYS, MIN_PARTY_SIZE } from "@/lib/pricing";
import { ROOMS, getRoom } from "@/lib/rooms";
import type { Slot } from "@/lib/types";

// Unique venue locations, in first-seen order.
const LOCATIONS = ROOMS.reduce<string[]>((acc, r) => {
  if (!acc.includes(r.location)) acc.push(r.location);
  return acc;
}, []);

// Filter dropdown items: all, then by location, then by individual experience.
// Values are prefixed so the same control can filter on either dimension.
const FILTER_ITEMS: SelectItem[] = [
  { value: "all", label: "Filter: all experiences" },
  ...(LOCATIONS.length > 1
    ? [{ heading: "Locations" as const }, ...LOCATIONS.map((loc) => ({ value: `loc:${loc}`, label: loc }))]
    : []),
  { heading: "Experiences" },
  ...ROOMS.map((r) => ({ value: `room:${r.id}`, label: r.name })),
];

function matchesFilter(slot: Slot, filter: string): boolean {
  if (filter === "all") return true;
  if (filter.startsWith("loc:")) return slot.location === filter.slice(4);
  if (filter.startsWith("room:")) return slot.roomId === filter.slice(5);
  return true;
}

export default function BrowsePage() {
  const router = useRouter();
  const { items, addItem } = useCart();

  const [date, setDate] = useState(todayISO());
  const [filter, setFilter] = useState("all");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(MIN_PARTY_SIZE);
  const [expiredNotice, setExpiredNotice] = useState(false);

  // Deep-link support: /?date=YYYY-MM-DD&slot=roomId|HH:MM (used by "Edit booking"),
  // and /?expired=1 after a lapsed hold. Read once on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qDate = params.get("date");
    const qSlot = params.get("slot");
    if (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate)) setDate(qDate);
    if (qDate && qSlot) {
      const [roomId, time] = qSlot.split("|");
      if (roomId && time) setExpandedKey(`${roomId}|${qDate}|${time}`);
    }
    if (params.get("expired")) setExpiredNotice(true);
    if (qDate || qSlot || params.get("expired")) {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  const loadSlots = useCallback(async () => {
    setSlots(null);
    setError(null);
    try {
      const res = await fetch(`/api/availability?date=${date}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load availability.");
      setSlots(data.slots);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load availability. Check your connection and try again.");
    }
  }, [date]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const visibleSlots = useMemo(
    () => (slots ?? []).filter((s) => matchesFilter(s, filter)),
    [slots, filter]
  );

  const today = todayISO();
  const lastBookable = addDaysISO(today, BOOKING_WINDOW_DAYS);

  function toggleSlot(slot: Slot) {
    const key = itemKey(slot);
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    const existing = items.find((i) => itemKey(i) === key);
    setQuantity(existing ? existing.quantity : MIN_PARTY_SIZE);
    setExpandedKey(key);
  }

  function continueToCheckout(slot: Slot) {
    addItem({
      roomId: slot.roomId,
      roomName: slot.roomName,
      location: slot.location,
      date: slot.date,
      time: slot.time,
      quantity,
      priceCents: slot.priceCents,
      durationMinutes: slot.durationMinutes,
    });
    router.push("/checkout");
  }

  return (
    <>
      <ProgressSteps current={1} />

      {expiredNotice && (
        <div className="error-banner">
          Your booking hold expired, so your cart was cleared. Pick your time slots again to rebook.
        </div>
      )}

      <h1 className="page-title">Browse availability</h1>
      <p className="page-subtitle">Select an experience, date and time, then choose your booking options.</p>

      <div className="browse-controls">
        <SelectMenu
          value={filter}
          onChange={setFilter}
          ariaLabel="Filter by location or experience"
          items={FILTER_ITEMS}
        />

        <DatePicker
          value={date}
          min={today}
          max={lastBookable}
          onChange={(d) => {
            setDate(d);
            setExpandedKey(null);
          }}
        />

        <div className="day-nav">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setDate(today);
              setExpandedKey(null);
            }}
          >
            Today
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={date <= today}
            onClick={() => {
              setDate(addDaysISO(date, -1));
              setExpandedKey(null);
            }}
          >
            ← Prev
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={date >= lastBookable}
            onClick={() => {
              setDate(addDaysISO(date, 1));
              setExpandedKey(null);
            }}
          >
            Next →
          </button>
        </div>
      </div>

      <h2 className="day-heading">{date === today ? "Today" : formatDateLong(date)}</h2>

      {error && (
        <div className="empty-state">
          <p className="error-banner">{error}</p>
          <button type="button" className="btn" onClick={loadSlots}>
            Try again
          </button>
        </div>
      )}
      {!error && slots === null && <p className="empty-state">Loading availability…</p>}
      {!error && slots !== null && visibleSlots.length === 0 && (
        <p className="empty-state">No time slots available for this selection. Try another date.</p>
      )}

      <ul className="slot-list">
        {visibleSlots.map((slot) => {
          const key = itemKey(slot);
          const room = getRoom(slot.roomId);
          const soldOut = slot.remaining === 0;
          // Fewer spots left than the minimum party size — can't be booked.
          const belowMin = !soldOut && slot.remaining < MIN_PARTY_SIZE;
          const bookable = !soldOut && !belowMin;
          const expanded = expandedKey === key;
          const [timePart, period] = formatTime(slot.time).split(" ");
          const badge = dateBadgeParts(slot.date);

          return (
            <li key={key}>
              <div className="slot-row">
                <div className="slot-time">
                  {timePart}
                  <span className="period">{period}</span>
                </div>
                <RoomBadge name={slot.roomName} bg={room?.badgeBg ?? "#0B2540"} fg={room?.badgeFg ?? "#fff"} />
                <div className="slot-info">
                  <div className="slot-name">
                    {slot.roomName} — {slot.location}
                  </div>
                  <div className="slot-tagline">{slot.tagline}</div>
                </div>
                <div className="slot-price">
                  <span className="label">Book now</span>
                  <span className="amount">{formatMoney(slot.priceCents)}</span>
                  <span className="label">each</span>
                </div>
                <div className="slot-action">
                  {soldOut ? (
                    <button type="button" className="btn btn-block btn-sold-out" disabled>
                      Sold out
                    </button>
                  ) : belowMin ? (
                    <button
                      type="button"
                      className="btn btn-block btn-sold-out"
                      disabled
                      title={`Bookings need at least ${MIN_PARTY_SIZE} players and only ${slot.remaining} spot(s) remain.`}
                    >
                      Only {slot.remaining} left
                    </button>
                  ) : (
                    <button type="button" className="btn btn-block" onClick={() => toggleSlot(slot)}>
                      {expanded ? "Selected ▾" : "Book now ▾"}
                    </button>
                  )}
                </div>
              </div>

              {expanded && bookable && (
                <div className="booking-panel">
                  <div
                    className="panel-poster"
                    style={{ background: room?.badgeBg ?? "#0B2540", color: room?.badgeFg ?? "#fff" }}
                  >
                    <span className="date-badge">
                      <span className="weekday">{badge.weekday}</span>
                      <span className="day">{badge.day}</span>
                      <span className="month">{badge.month}</span>
                    </span>
                    <span className="poster-title">{slot.roomName}</span>
                  </div>
                  <div className="panel-body">
                    <h3 className="panel-title">
                      {slot.roomName} — {slot.location}
                    </h3>
                    <div className="panel-meta">
                      <span>{formatTime(slot.time)}</span>
                      <span>{slot.durationMinutes} minutes</span>
                      <span>
                        {slot.remaining}/{slot.capacity} available
                      </span>
                    </div>
                    <p className="panel-description">{slot.description}</p>
                    <div className="panel-controls">
                      <span className="quantity-label">
                        Quantity
                        <span className="unit-price">
                          {formatMoney(slot.priceCents)} each · minimum {MIN_PARTY_SIZE}
                        </span>
                      </span>
                      <div className="stepper">
                        <button
                          type="button"
                          onClick={() => setQuantity((q) => Math.max(MIN_PARTY_SIZE, q - 1))}
                          disabled={quantity <= MIN_PARTY_SIZE}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span className="value">{quantity}</span>
                        <button
                          type="button"
                          onClick={() => setQuantity((q) => Math.min(slot.remaining, q + 1))}
                          disabled={quantity >= slot.remaining}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      <span className="panel-subtotal">
                        Subtotal
                        <span className="amount">{formatMoney(quantity * slot.priceCents)}</span>
                      </span>
                      <button type="button" className="btn panel-continue" onClick={() => continueToCheckout(slot)}>
                        Continue
                      </button>
                    </div>
                  </div>
                  <button type="button" className="panel-close" onClick={() => setExpandedKey(null)} aria-label="Close">
                    ×
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
