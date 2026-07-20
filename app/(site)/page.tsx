"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import FilterMenu, { type FilterItem } from "@/components/FilterMenu";
import ProgressSteps from "@/components/ProgressSteps";
import RoomBadge from "@/components/RoomBadge";
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
import type { Slot } from "@/lib/types";

const FILTER_ALL_LABEL = "Filter: all experiences";

type ExperienceSummary = { id: string; name: string; location: string };

// Location and experience are two facets combined with AND: a slot must be in
// one of the selected locations (if any) AND be one of the selected experiences
// (if any). Within a facet, multiple selections are OR. Empty facets match all.
function passesFilters(slot: Slot, filters: string[]): boolean {
  const locations = filters.filter((f) => f.startsWith("loc:")).map((f) => f.slice(4));
  const rooms = filters.filter((f) => f.startsWith("room:")).map((f) => f.slice(5));
  const locationOk = locations.length === 0 || locations.includes(slot.location);
  const roomOk = rooms.length === 0 || rooms.includes(slot.roomId);
  return locationOk && roomOk;
}

export default function BrowsePage() {
  const router = useRouter();
  const { items, addItem } = useCart();

  const [date, setDate] = useState(todayISO());
  const [filters, setFilters] = useState<string[]>([]);
  const [experiences, setExperiences] = useState<ExperienceSummary[]>([]);
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

  // The experience list (for the filter) rarely changes — load it once.
  useEffect(() => {
    fetch("/api/experiences")
      .then((res) => res.json())
      .then((data) => setExperiences(data.experiences ?? []))
      .catch(() => setExperiences([]));
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

  const locations = useMemo(
    () =>
      experiences.reduce<string[]>((acc, e) => {
        if (!acc.includes(e.location)) acc.push(e.location);
        return acc;
      }, []),
    [experiences]
  );

  // Once a location is chosen, experiences at other locations no longer apply —
  // drop them so a Northside filter can't keep showing a Downtown room.
  const normalizeFilters = useCallback(
    (fs: string[]): string[] => {
      const selectedLocations = fs.filter((f) => f.startsWith("loc:")).map((f) => f.slice(4));
      if (selectedLocations.length === 0) return fs;
      return fs.filter((f) => {
        if (!f.startsWith("room:")) return true;
        const exp = experiences.find((e) => e.id === f.slice(5));
        return !!exp && selectedLocations.includes(exp.location);
      });
    },
    [experiences]
  );

  // Experiences shown are scoped to any selected locations, so you can't pick a
  // room from a location you've filtered out.
  const filterItems = useMemo<FilterItem[]>(() => {
    const items: FilterItem[] = [];
    if (locations.length > 1) {
      items.push({ heading: "Locations" });
      for (const loc of locations) items.push({ value: `loc:${loc}`, label: loc });
    }
    const selectedLocations = filters.filter((f) => f.startsWith("loc:")).map((f) => f.slice(4));
    const scoped = selectedLocations.length
      ? experiences.filter((e) => selectedLocations.includes(e.location))
      : experiences;
    items.push({ heading: "Experiences" });
    for (const e of scoped) items.push({ value: `room:${e.id}`, label: e.name });
    return items;
  }, [experiences, locations, filters]);

  const toggleFilter = (value: string) =>
    setFilters((fs) =>
      normalizeFilters(fs.includes(value) ? fs.filter((v) => v !== value) : [...fs, value])
    );

  const visibleSlots = useMemo(
    () => (slots ?? []).filter((s) => passesFilters(s, filters)),
    [slots, filters]
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
      badgeBg: slot.badgeBg,
      badgeFg: slot.badgeFg,
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
        <FilterMenu
          items={filterItems}
          selected={filters}
          onToggle={toggleFilter}
          onClear={() => setFilters([])}
          ariaLabel="Filter by location or experience"
          allLabel={FILTER_ALL_LABEL}
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
                <RoomBadge name={slot.roomName} bg={slot.badgeBg} fg={slot.badgeFg} />
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
                    style={
                      slot.imageUrl
                        ? { padding: 0, color: "#fff" }
                        : { background: slot.badgeBg, color: slot.badgeFg }
                    }
                  >
                    {slot.imageUrl && (
                      <img src={slot.imageUrl} alt={slot.roomName} className="panel-poster-img" />
                    )}
                    <span className="date-badge">
                      <span className="weekday">{badge.weekday}</span>
                      <span className="day">{badge.day}</span>
                      <span className="month">{badge.month}</span>
                    </span>
                    {!slot.imageUrl && <span className="poster-title">{slot.roomName}</span>}
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
