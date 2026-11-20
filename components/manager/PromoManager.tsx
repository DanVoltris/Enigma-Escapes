"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SingleSelect from "@/components/SingleSelect";
import { promoOffLabel } from "@/lib/promo-label";
import { dateRangeLabel } from "@/lib/promo-dates";
import type { Promo } from "@/lib/types";

type Room = { id: string; name: string; location: string };

// Ticks for the rooms a code is limited to. None ticked = every room.
function RoomPicker({ rooms, value, onChange }: { rooms: Room[]; value: string[]; onChange: (ids: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="vch-items">
      {rooms.map((r) => (
        <label key={r.id} className="vch-check">
          <input type="checkbox" checked={value.includes(r.id)} onChange={() => toggle(r.id)} />
          {r.name} <span style={{ color: "var(--text-secondary)" }}>· {r.location}</span>
        </label>
      ))}
    </div>
  );
}

type Dates = { useFrom: string; useUntil: string; playFrom: string; playUntil: string };
const NO_DATES: Dates = { useFrom: "", useUntil: "", playFrom: "", playUntil: "" };
const datesOf = (p: Promo): Dates => ({
  useFrom: p.useFrom ?? "",
  useUntil: p.useUntil ?? "",
  playFrom: p.playFrom ?? "",
  playUntil: p.playUntil ?? "",
});

// The two date ranges on a code, both optional (blank = no limit that side):
// the days it can be typed in, and the days of the games it takes money off.
// A Black Friday sale is usually one or the other; both is fine too.
function DatesPicker({ value, onChange }: { value: Dates; onChange: (d: Dates) => void }) {
  const field = (key: keyof Dates, label: string) => (
    <div className="field">
      <label htmlFor={`promo-${key}`}>{label}</label>
      <input
        id={`promo-${key}`}
        type="date"
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <p className="sub" style={{ margin: "0 0 4px" }}>
          <strong>Can be used</strong> — the days customers (or the desk) can apply it, for a game any day.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {field("useFrom", "From")}
          {field("useUntil", "Until")}
        </div>
      </div>
      <div>
        <p className="sub" style={{ margin: "0 0 4px" }}>
          <strong>Games played</strong> — only sessions on these days are discounted, whenever they're booked.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {field("playFrom", "From")}
          {field("playUntil", "Until")}
        </div>
      </div>
      <p className="sub" style={{ margin: 0 }}>Leave a box empty for no limit on that side. Both ends count.</p>
    </div>
  );
}

// "Used Nov 27–29 · Games Nov 27–29", or "Any day".
function datesText(p: Promo): string {
  const parts: string[] = [];
  const use = dateRangeLabel(p.useFrom, p.useUntil);
  if (use) parts.push(`Used ${use}`);
  const play = dateRangeLabel(p.playFrom, p.playUntil);
  if (play) parts.push(`Games ${play}`);
  return parts.length ? parts.join(" · ") : "Any day";
}

export default function PromoManager({ promos, rooms }: { promos: Promo[]; rooms: Room[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("10");
  // "$ off" codes take a fixed amount off the whole booking, before tax.
  const [kind, setKind] = useState<"percent" | "amount" | "amountEach">("percent");
  const [amount, setAmount] = useState("20");
  const [staffOnly, setStaffOnly] = useState(false);
  const [earns, setEarns] = useState(false);
  const [rewardPercent, setRewardPercent] = useState("20");
  const [rewardDays, setRewardDays] = useState("7");
  const [rewardMultiUse, setRewardMultiUse] = useState(false);
  // Some rooms only — WELCOMEBACKSOS for the room that came back.
  const [someRooms, setSomeRooms] = useState(false);
  const [roomIds, setRoomIds] = useState<string[]>([]);
  // The code whose rooms are being changed in the list, and the ticks so far.
  const [editingRooms, setEditingRooms] = useState<{ code: string; ids: string[] } | null>(null);
  // Only on some dates — a Black Friday weekend.
  const [someDates, setSomeDates] = useState(false);
  const [dates, setDates] = useState<Dates>(NO_DATES);
  const [editingDates, setEditingDates] = useState<{ code: string; dates: Dates } | null>(null);
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? "a removed room";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCode, setConfirmCode] = useState<string | null>(null); // code pending delete confirmation

  async function addPromo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (someRooms && roomIds.length === 0) {
      setError("Tick the rooms this code works on, or untick “Only some rooms”.");
      return;
    }
    if (someDates && !dates.useFrom && !dates.useUntil && !dates.playFrom && !dates.playUntil) {
      setError("Pick the dates this code works for, or untick “Only on some dates”.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/manager/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          ...(kind === "percent"
            ? { percentOff: Number(percent) }
            : { amountOff: Number(amount), amountPerPerson: kind === "amountEach" }),
          staffOnly,
          rewardPercent: earns ? Number(rewardPercent) : 0,
          rewardDays: earns ? Number(rewardDays) : 0,
          rewardMultiUse: earns && rewardMultiUse,
          roomIds: someRooms ? roomIds : [],
          ...(someDates ? dates : NO_DATES),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save the code.");
      setCode("");
      setStaffOnly(false);
      setSomeRooms(false);
      setRoomIds([]);
      setSomeDates(false);
      setDates(NO_DATES);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the code.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(
    promo: Promo,
    patch: { active?: boolean; staffOnly?: boolean; roomIds?: string[]; dates?: Dates }
  ) {
    setError(null);
    try {
      const res = await fetch(`/api/manager/promos/${encodeURIComponent(promo.code)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update the code.");
      if (patch.roomIds) setEditingRooms(null);
      if (patch.dates) setEditingDates(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the code.");
    }
  }

  async function remove(codeToRemove: string) {
    setError(null);
    try {
      const res = await fetch(`/api/manager/promos/${encodeURIComponent(codeToRemove)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not remove the code.");
      setConfirmCode(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the code.");
    }
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="mgr-card">
        <h2>Add a code</h2>
        <p className="card-sub">
          Customers type this at checkout to get the discount — or, for a staff-only code, the desk applies it
          when taking a booking.
        </p>
        <form className="mgr-inline-form" onSubmit={addPromo}>
          <div className="field">
            <label htmlFor="promo-code">Code</label>
            <input
              id="promo-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. SUMMER20"
              style={{ minWidth: 200, textTransform: "uppercase" }}
            />
          </div>
          <div className="field" style={{ minWidth: 190 }}>
            <label>Type</label>
            <SingleSelect
              value={kind}
              onChange={(v) => setKind(v as "percent" | "amount" | "amountEach")}
              ariaLabel="What kind of discount"
              options={[
                { value: "percent", label: "% off" },
                { value: "amount", label: "$ off the booking" },
                { value: "amountEach", label: "$ off each person" },
              ]}
            />
          </div>
          {kind === "percent" ? (
            <div className="field">
              <label htmlFor="promo-percent">Discount (%)</label>
              <input
                id="promo-percent"
                type="text"
                inputMode="decimal"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                style={{ width: 100 }}
              />
            </div>
          ) : (
            <div className="field">
              {/* Before tax, like a percentage: $20 off is $21 off the total with 5% GST. */}
              <label htmlFor="promo-amount">
                {kind === "amountEach" ? "Off each person, before tax ($)" : "Amount off, before tax ($)"}
              </label>
              <input
                id="promo-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ width: 120 }}
              />
            </div>
          )}
          <label className="checkbox-row" style={{ alignSelf: "center" }}>
            <input type="checkbox" checked={staffOnly} onChange={(e) => setStaffOnly(e.target.checked)} />
            <span>Staff only — works at the desk, never on the website</span>
          </label>
          <label className="checkbox-row" style={{ alignSelf: "center" }}>
            <input type="checkbox" checked={someRooms} onChange={(e) => setSomeRooms(e.target.checked)} />
            <span>Only some rooms</span>
          </label>
          {someRooms && (
            <div style={{ flexBasis: "100%" }}>
              <RoomPicker rooms={rooms} value={roomIds} onChange={setRoomIds} />
            </div>
          )}
          <label className="checkbox-row" style={{ alignSelf: "center" }}>
            <input type="checkbox" checked={someDates} onChange={(e) => setSomeDates(e.target.checked)} />
            <span>Only on some dates</span>
          </label>
          {someDates && (
            <div style={{ flexBasis: "100%" }}>
              <DatesPicker value={dates} onChange={setDates} />
            </div>
          )}
          {/* A code can hand the customer a second code with their confirmation
              text — the hotel guest who books at 10% off and gets 20% off for
              the rest of the week. */}
          <label className="checkbox-row" style={{ alignSelf: "center" }}>
            <input type="checkbox" checked={earns} onChange={(e) => setEarns(e.target.checked)} />
            <span>Texts them a follow-up code with their confirmation</span>
          </label>
          {earns && (
            <>
              <div className="field">
                <label htmlFor="promo-reward-percent">Follow-up discount (%)</label>
                <input
                  id="promo-reward-percent"
                  type="text"
                  inputMode="numeric"
                  value={rewardPercent}
                  onChange={(e) => setRewardPercent(e.target.value)}
                  style={{ width: 100 }}
                />
              </div>
              <div className="field">
                <label htmlFor="promo-reward-days">Good for (days)</label>
                <input
                  id="promo-reward-days"
                  type="text"
                  inputMode="numeric"
                  value={rewardDays}
                  onChange={(e) => setRewardDays(e.target.value)}
                  style={{ width: 100 }}
                />
              </div>
              <label className="checkbox-row" style={{ alignSelf: "center" }}>
                <input
                  type="checkbox"
                  checked={rewardMultiUse}
                  onChange={(e) => setRewardMultiUse(e.target.checked)}
                />
                <span>They can use it on every game until it expires, not just once</span>
              </label>
            </>
          )}
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Adding…" : "Add code"}
          </button>
        </form>
      </div>

      <div className="mgr-card">
        <h2>Your codes</h2>
        <p className="card-sub">
          Turning a code off stops new uses; removing deletes it entirely. Either way, bookings already made
          keep the discount they were given.
        </p>
        {promos.length === 0 ? (
          <p className="mgr-empty">No codes yet — add your first one above.</p>
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th className="num">Discount</th>
                  <th>Works</th>
                  <th>Rooms</th>
                  <th>Dates</th>
                  <th>Follow-up code</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <tr key={p.code}>
                    <td>
                      <strong>{p.code}</strong>
                    </td>
                    <td className="num">{promoOffLabel(p)}</td>
                    <td>{p.staffOnly ? "Desk only" : "Website + desk"}</td>
                    <td>
                      {editingRooms?.code === p.code ? (
                        <div>
                          <p className="sub" style={{ margin: "0 0 6px" }}>None ticked = every room.</p>
                          <RoomPicker
                            rooms={rooms}
                            value={editingRooms.ids}
                            onChange={(ids) => setEditingRooms({ code: p.code, ids })}
                          />
                          <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => toggle(p, { roomIds: editingRooms.ids })}
                            >
                              Save rooms
                            </button>
                            <button type="button" className="link-button" onClick={() => setEditingRooms(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {p.roomIds.length > 0 ? p.roomIds.map(roomName).join(", ") : "Every room"}{" "}
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => setEditingRooms({ code: p.code, ids: p.roomIds })}
                          >
                            Change
                          </button>
                        </>
                      )}
                    </td>
                    <td>
                      {editingDates?.code === p.code ? (
                        <div>
                          <DatesPicker
                            value={editingDates.dates}
                            onChange={(d) => setEditingDates({ code: p.code, dates: d })}
                          />
                          <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => toggle(p, { dates: editingDates.dates })}
                            >
                              Save dates
                            </button>
                            <button type="button" className="link-button" onClick={() => setEditingDates(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {datesText(p)}{" "}
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => setEditingDates({ code: p.code, dates: datesOf(p) })}
                          >
                            Change
                          </button>
                        </>
                      )}
                    </td>
                    <td>
                      {p.rewardPercent > 0
                        ? `${p.rewardPercent}% off, ${p.rewardDays} day${p.rewardDays === 1 ? "" : "s"}` +
                          (p.rewardMultiUse ? ", every game" : ", once")
                        : "—"}
                    </td>
                    <td>
                      <span className={`mgr-pill${p.active ? " on" : ""}`}>{p.active ? "Active" : "Off"}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                        <button type="button" className="link-button" onClick={() => toggle(p, { active: !p.active })}>
                          {p.active ? "Turn off" : "Turn on"}
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => toggle(p, { staffOnly: !p.staffOnly })}
                        >
                          {p.staffOnly ? "Allow on website" : "Make desk only"}
                        </button>
                        {confirmCode === p.code ? (
                          <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                            <span style={{ color: "var(--text-secondary)" }}>Remove?</span>
                            <button type="button" className="link-button danger" onClick={() => remove(p.code)}>
                              Yes, remove
                            </button>
                            <button type="button" className="link-button" onClick={() => setConfirmCode(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="link-button danger" onClick={() => setConfirmCode(p.code)}>
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
