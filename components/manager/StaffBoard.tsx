"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import SingleSelect from "@/components/SingleSelect";
import { formatDuration, type StaffMember } from "@/lib/staff-types";

export type OnShift = { memberId: string; memberName: string; location: string | null; minutes: number };
export type Room = { id: string; name: string; location: string };

// Check in, check out, and see who's on. Built for a shared login: nobody is
// identified by the account, so a shift starts by tapping your own name.
export default function StaffBoard({
  members,
  onShift,
  rooms,
  locations,
  canManage,
}: {
  members: StaffMember[];
  onShift: OnShift[];
  rooms: Room[];
  locations: string[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<StaffMember | null>(null);
  const [where, setWhere] = useState(locations[0] ?? "");

  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const onNow = new Map(onShift.map((s) => [s.memberId, s]));

  async function clock(memberId: string, action: "in" | "out", location?: string) {
    setBusy(memberId);
    setError(null);
    try {
      const res = await fetch("/api/manager/roster/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, action, location }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not record that.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record that.");
    } finally {
      setBusy(null);
      setPending(null);
    }
  }

  const active = members.filter((m) => m.active);

  return (
    <>
      <div className="mgr-card">
        <h2>On shift now</h2>
        {onShift.length === 0 ? (
          <p className="mgr-empty">Nobody is checked in.</p>
        ) : (
          <ul className="shift-list">
            {onShift.map((s) => {
              const m = members.find((x) => x.id === s.memberId);
              return (
                <li key={s.memberId}>
                  <span className="who">{s.memberName}</span>
                  <span className="where">{s.location ?? "—"}</span>
                  <span className="rooms">
                    {m && m.trainedRooms.length > 0
                      ? m.trainedRooms
                          .map((id) => roomName.get(id))
                          .filter(Boolean)
                          .join(", ")
                      : "no rooms recorded"}
                  </span>
                  <span className="mins">{formatDuration(s.minutes)}</span>
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={busy === s.memberId}
                    onClick={() => clock(s.memberId, "out")}
                  >
                    {busy === s.memberId ? "…" : "Check out"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="field-error">{error}</p>}
      </div>

      <div className="mgr-card">
        <h2>Check in</h2>
        <p className="card-sub">Tap your name to start your shift.</p>
        {locations.length > 1 && (
          <div className="field" style={{ maxWidth: 220 }}>
            <label>Location</label>
            <SingleSelect
              value={where}
              onChange={setWhere}
              ariaLabel="Location"
              options={locations.map((l) => ({ value: l, label: l }))}
            />
          </div>
        )}
        <div className="staff-grid">
          {active.map((m) => {
            const on = onNow.get(m.id);
            return (
              <button
                key={m.id}
                type="button"
                className={`staff-chip${on ? " on" : ""}`}
                disabled={busy === m.id || Boolean(on)}
                onClick={() => setPending(m)}
                title={on ? `On shift at ${on.location ?? "—"}` : `Check ${m.name} in`}
              >
                <strong>{m.name}</strong>
                <span>{on ? `on since ${formatDuration(on.minutes)} ago` : (m.homeLocation ?? "Both sites")}</span>
              </button>
            );
          })}
        </div>
        {active.length === 0 && (
          <p className="mgr-empty">
            Nobody on the staff list yet{canManage ? " — add people below." : "."}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `Check in ${pending.name}?` : ""}
        confirmLabel="Check in"
        busy={busy !== null}
        onConfirm={() => pending && clock(pending.id, "in", where || undefined)}
        onCancel={() => setPending(null)}
      >
        <p>
          Starts a shift at <strong>{where || "this location"}</strong>, timed from now. Check out at the end of the
          shift to record the hours.
        </p>
      </ConfirmDialog>
    </>
  );
}
