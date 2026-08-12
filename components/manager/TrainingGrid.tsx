"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { StaffMember } from "@/lib/staff-types";
import type { Room } from "@/components/manager/StaffBoard";

// Who is signed off to run which room. Ticking a box saves immediately —
// training changes get recorded mid-shift, and a Save button people forget to
// press is worse than no record at all.
export default function TrainingGrid({ members, rooms }: { members: StaffMember[]; rooms: Room[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const byLocation = rooms.reduce<Record<string, Room[]>>((acc, r) => {
    (acc[r.location] ??= []).push(r);
    return acc;
  }, {});
  const locations = Object.keys(byLocation).sort();

  async function save(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/manager/roster/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save that.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleRoom(m: StaffMember, roomId: string) {
    const next = m.trainedRooms.includes(roomId)
      ? m.trainedRooms.filter((r) => r !== roomId)
      : [...m.trainedRooms, roomId];
    await save(m.id, { trainedRooms: next });
  }

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/manager/roster/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not remove that person.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that person.");
    } finally {
      setBusy(null);
      setConfirmId(null);
    }
  }

  async function add() {
    setBusy("new");
    setError(null);
    try {
      const res = await fetch("/api/manager/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not add that person.");
      setName("");
      setAdding(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that person.");
    } finally {
      setBusy(null);
    }
  }

  const pending = members.find((m) => m.id === confirmId);

  return (
    <div className="mgr-card">
      <h2>Room training</h2>
      <p className="card-sub">
        Which rooms each person is signed off to run. Changes save as you tick.
      </p>
      {error && <p className="field-error">{error}</p>}

      <div className="vch-save" style={{ marginBottom: 12 }}>
        {adding ? (
          <>
            <div className="field" style={{ maxWidth: 260, marginBottom: 0 }}>
              <label htmlFor="tg-name">Name</label>
              <input id="tg-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <button type="button" className="btn" onClick={add} disabled={busy === "new" || name.trim() === ""}>
              {busy === "new" ? "Adding…" : "Add"}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            + Add someone
          </button>
        )}
      </div>

      <div className="mgr-table-wrap">
        <table className="mgr-table train-grid">
          <thead>
            <tr>
              <th>Name</th>
              {locations.map((loc) =>
                byLocation[loc].map((r, i) => (
                  <th key={r.id} className="rot" title={`${r.name} · ${loc}`}>
                    <span className={i === 0 ? "first" : undefined}>{r.name}</span>
                  </th>
                ))
              )}
              <th className="num">Rooms</th>
              <th style={{ width: 90 }}>Active</th>
              <th style={{ width: 50 }} />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className={m.active ? undefined : "dim"}>
                <td>{m.name}</td>
                {locations.map((loc) =>
                  byLocation[loc].map((r) => (
                    <td key={r.id} className="tick">
                      <input
                        type="checkbox"
                        checked={m.trainedRooms.includes(r.id)}
                        disabled={busy === m.id}
                        onChange={() => toggleRoom(m, r.id)}
                        aria-label={`${m.name} trained on ${r.name}`}
                      />
                    </td>
                  ))
                )}
                <td className="num">{m.trainedRooms.length}</td>
                <td>
                  <button
                    type="button"
                    className={`vch-toggle${m.active ? " on" : ""}`}
                    disabled={busy === m.id}
                    onClick={() => save(m.id, { active: !m.active })}
                  >
                    {m.active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="vp-remove"
                    disabled={busy === m.id}
                    onClick={() => setConfirmId(m.id)}
                    aria-label={`Remove ${m.name}`}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pending !== undefined}
        title="Remove this person?"
        confirmLabel="Remove"
        busy={busy === confirmId}
        onConfirm={() => pending && remove(pending.id)}
        onCancel={() => setConfirmId(null)}
      >
        {pending && (
          <p>
            <strong>{pending.name}</strong> comes off the staff list. Shifts they already worked stay on the record.
            To keep the history and just stop them checking in, mark them inactive instead.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
