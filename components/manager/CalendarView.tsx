"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RoomBadge from "@/components/RoomBadge";
import { formatDateLong, formatMoney, formatTime } from "@/lib/format";

// One booking's slice of a single session, as shown in the slide-over panel.
// Money is booking-level (the whole transaction); quantity is this session's party.
export type SessionBooking = {
  bookingId: string;
  reference: string;
  name: string;
  email: string;
  quantity: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  noShow: boolean;
  source: "online" | "in_person";
};

type Experience = {
  id: string;
  name: string;
  location: string;
  capacity: number;
  badgeBg: string;
  badgeFg: string;
  times: string[]; // start times offered on the viewed date
};

type Props = {
  view: "calendar" | "list";
  date: string;
  isToday: boolean;
  nowMinutes: number;
  experiences: Experience[];
  allTimes: string[];
  sessionsByKey: Record<string, SessionBooking[]>; // key = `${roomId}|${time}`
  blockedKeys: string[]; // same key shape — slots taken out of service
};

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export default function CalendarView({
  view,
  date,
  isToday,
  nowMinutes,
  experiences,
  allTimes,
  sessionsByKey,
  blockedKeys,
}: Props) {
  // The session whose bookings are shown in the panel; null when closed.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const countOf = (key: string) => (sessionsByKey[key] ?? []).reduce((s, b) => s + b.quantity, 0);
  const blocked = useMemo(() => new Set(blockedKeys), [blockedKeys]);

  // Close the panel on Escape while it's open.
  useEffect(() => {
    if (!selectedKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedKey(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedKey]);

  return (
    <>
      {view === "calendar" ? (
        <>
          <p className="mgr-page-sub">Who&apos;s booked into each session. Click a session with guests to see its bookings.</p>
          <div className="mgr-cal-wrap">
            <table className="mgr-cal">
              <thead>
                <tr>
                  <th>Time</th>
                  {experiences.map((e) => (
                    <th key={e.id}>
                      {e.name}
                      <br />
                      <span style={{ fontWeight: 400 }}>{e.location}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allTimes.map((time) => (
                  <tr key={time}>
                    <th scope="row">{formatTime(time)}</th>
                    {experiences.map((e) => {
                      const key = `${e.id}|${time}`;
                      const count = countOf(key);
                      // "Not offered at this time" — unless somebody is booked
                      // into it anyway, which happens with sessions carried over
                      // from the old system. Hiding those was how a sold game
                      // could be missing from the grid entirely.
                      if (!e.times.includes(time) && count === 0) {
                        return (
                          <td key={e.id}>
                            <span className="cell na">—</span>
                          </td>
                        );
                      }
                      const offSchedule = !e.times.includes(time);
                      const isBlocked = blocked.has(key);
                      // Blocked shows red whatever else is true. A blocked slot
                      // that still holds guests is worth seeing loudly — it
                      // means someone was booked in before it was taken out of
                      // service, and they still need dealing with.
                      const cls = isBlocked
                        ? " blocked"
                        : count === 0
                          ? ""
                          : count >= e.capacity
                            ? " full"
                            : " some";
                      const label = isBlocked && count === 0 ? "Blocked" : `${count}/${e.capacity}`;
                      const title = isBlocked
                        ? `${e.name} at ${formatTime(time)}: blocked off — can't be booked${
                            count > 0 ? `, but ${count} already booked in` : ""
                          }`
                        : offSchedule
                          ? `${e.name} at ${formatTime(time)}: ${count} booked, but this isn't one of the room's start times — carried over from the old system. Nobody can book it here.`
                          : `${e.name} at ${formatTime(time)}: ${count} of ${e.capacity} spots booked — view bookings`;
                      return (
                        <td key={e.id}>
                          {count > 0 ? (
                            <button
                              type="button"
                              className={`cell${cls}`}
                              onClick={() => setSelectedKey(key)}
                              title={title}
                            >
                              {label}
                            </button>
                          ) : (
                            <span className={`cell${cls}`} title={title}>
                              {label}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mgr-legend">
            <span>
              <span className="chip" style={{ background: "#fff" }} /> 0 booked
            </span>
            <span>
              <span className="chip" style={{ background: "var(--slot-some)" }} /> partly booked
            </span>
            <span>
              <span className="chip" style={{ background: "var(--slot-full)" }} /> full
            </span>
            <span>
              <span className="chip" style={{ background: "var(--slot-blocked)" }} /> blocked off
            </span>
            <span>
              <span className="chip chip-na" /> not offered at this time
            </span>
          </div>
        </>
      ) : (
        <ListView
          date={date}
          isToday={isToday}
          nowMinutes={nowMinutes}
          experiences={experiences}
          countOf={countOf}
          onSelect={setSelectedKey}
          blocked={blocked}
        />
      )}

      {selectedKey && (
        <SessionPanel
          selectedKey={selectedKey}
          date={date}
          experiences={experiences}
          bookings={sessionsByKey[selectedKey] ?? []}
          count={countOf(selectedKey)}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </>
  );
}

function ListView({
  date,
  isToday,
  nowMinutes,
  experiences,
  countOf,
  onSelect,
  blocked,
}: {
  date: string;
  isToday: boolean;
  nowMinutes: number;
  experiences: Experience[];
  countOf: (key: string) => number;
  onSelect: (key: string) => void;
  blocked: Set<string>;
}) {
  const rows = experiences
    .flatMap((e) =>
      e.times.map((time) => ({
        key: `${e.id}|${time}`,
        time,
        name: e.name,
        location: e.location,
        capacity: e.capacity,
        badgeBg: e.badgeBg,
        badgeFg: e.badgeFg,
        count: countOf(`${e.id}|${time}`),
      }))
    )
    .sort((a, b) => (a.time === b.time ? a.name.localeCompare(b.name) : a.time.localeCompare(b.time)));

  return (
    <>
      <p className="mgr-page-sub">Every session for the day, in order. Click one with guests to see its bookings.</p>
      {rows.length === 0 ? (
        <p className="mgr-empty">No sessions scheduled for this date.</p>
      ) : (
        <div className="mgr-table-wrap">
          <table className="mgr-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Experience</th>
                <th className="num">Booked</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const passed = isToday && minutesOf(r.time) <= nowMinutes;
                const full = r.count >= r.capacity;
                const isBlocked = blocked.has(r.key);
                let status: { label: string; cls: string };
                // Blocked is the headline: it's the reason the slot can't be
                // sold, which matters more than how full it happens to be.
                if (isBlocked) status = { label: "Blocked off", cls: "blocked" };
                else if (passed) status = { label: "Passed", cls: "muted" };
                else if (full) status = { label: "Full", cls: "on" };
                else if (r.count > 0) status = { label: "Filling up", cls: "" };
                else status = { label: "Available", cls: "" };

                const hasGuests = r.count > 0;
                return (
                  <tr
                    key={r.key}
                    onClick={hasGuests ? () => onSelect(r.key) : undefined}
                    style={{ ...(passed ? { opacity: 0.6 } : null), ...(hasGuests ? { cursor: "pointer" } : null) }}
                  >
                    <td style={{ whiteSpace: "nowrap" }}>{formatTime(r.time)}</td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <RoomBadge name={r.name} bg={r.badgeBg} fg={r.badgeFg} />
                        <span>
                          {r.name}
                          <br />
                          <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{r.location}</span>
                        </span>
                      </span>
                    </td>
                    <td className="num">
                      {r.count}/{r.capacity}
                    </td>
                    <td>
                      <span
                        className={`mgr-pill${status.cls === "on" ? " on" : ""}${
                          status.cls === "blocked" ? " blocked" : ""
                        }`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td>
                      {hasGuests && (
                        <button
                          type="button"
                          className="mgr-linklike"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(r.key);
                          }}
                        >
                          View bookings
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function SessionPanel({
  selectedKey,
  date,
  experiences,
  bookings,
  count,
  onClose,
}: {
  selectedKey: string;
  date: string;
  experiences: Experience[];
  bookings: SessionBooking[];
  count: number;
  onClose: () => void;
}) {
  const [roomId, time] = selectedKey.split("|");
  const exp = experiences.find((e) => e.id === roomId);
  const name = exp?.name ?? "Session";

  return (
    <>
      <div className="mgr-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="mgr-drawer" role="dialog" aria-modal="true" aria-label={`Bookings for ${name}`}>
        <div className="mgr-drawer-head">
          <div>
            <h2>{name}</h2>
            {exp && <p className="loc">{exp.location}</p>}
            <p className="dt">
              {formatDateLong(date)} · {formatTime(time)}
            </p>
          </div>
          <button type="button" className="mgr-drawer-close" onClick={onClose} aria-label="Close panel">
            ×
          </button>
        </div>

        <div className="mgr-drawer-body">
          <p className="mgr-drawer-count">
            {count}
            {exp ? `/${exp.capacity}` : ""} booked · {bookings.length} booking{bookings.length === 1 ? "" : "s"}
          </p>

          {bookings.length === 0 ? (
            <p className="mgr-empty">No bookings in this session.</p>
          ) : (
            bookings.map((b) => (
              <div className="mgr-drawer-card" key={b.bookingId}>
                <Link href={`/manager/customers/${encodeURIComponent(b.email)}`} className="mgr-drawer-cust">
                  <span className="name">{b.name}</span>
                  <span className="email">{b.email}</span>
                </Link>

                <div className="mgr-drawer-tags">
                  <span>Party of {b.quantity}</span>
                  {b.source === "in_person" && <span className="mgr-pill">In-person</span>}
                  {b.noShow && (
                    <span className="mgr-pill" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                      No-show
                    </span>
                  )}
                </div>

                <div className="mgr-drawer-money">
                  <span>
                    <span className="k">Total</span>
                    {formatMoney(b.totalCents)}
                  </span>
                  <span>
                    <span className="k">Paid</span>
                    {formatMoney(b.paidCents)}
                  </span>
                  <span className={b.balanceCents > 0 ? "due" : undefined}>
                    <span className="k">Due</span>
                    {formatMoney(b.balanceCents)}
                  </span>
                </div>

                <Link href={`/manager/bookings/${b.bookingId}`} className="mgr-drawer-view">
                  View booking {b.reference} →
                </Link>
              </div>
            ))
          )}

          {exp && (
            <Link
              href={`/manager/bookings?date=${date}&q=${encodeURIComponent(exp.name)}`}
              className="mgr-drawer-all"
            >
              Open in Bookings →
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
