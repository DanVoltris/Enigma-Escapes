"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

export default function PromoManager({ promos, rooms }: { promos: Promo[]; rooms: Room[] }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("10");
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
    setBusy(true);
    try {
      const res = await fetch("/api/manager/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          percentOff: Number(percent),
          staffOnly,
          rewardPercent: earns ? Number(rewardPercent) : 0,
          rewardDays: earns ? Number(rewardDays) : 0,
          rewardMultiUse: earns && rewardMultiUse,
          roomIds: someRooms ? roomIds : [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save the code.");
      setCode("");
      setStaffOnly(false);
      setSomeRooms(false);
      setRoomIds([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the code.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(promo: Promo, patch: { active?: boolean; staffOnly?: boolean; roomIds?: string[] }) {
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
          <div className="field">
            <label htmlFor="promo-percent">Discount (%)</label>
            <input
              id="promo-percent"
              type="text"
              inputMode="numeric"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              style={{ width: 100 }}
            />
          </div>
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
                    <td className="num">{p.percentOff}% off</td>
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
