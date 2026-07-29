"use client";

import { useState } from "react";
import type { Checklist, ChecklistState } from "@/lib/checklists";

// Daily tick-off board plus an edit mode for managing the lists themselves.
// Ticks save per click; list edits save with the Save button (full replace).
export default function ChecklistsBoard({
  initialLists,
  initialState,
}: {
  initialLists: Checklist[];
  initialState: ChecklistState;
}) {
  const [lists, setLists] = useState<Checklist[]>(initialLists);
  const [checked, setChecked] = useState<Record<string, boolean>>(initialState.checked);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(itemId: string, value: boolean) {
    setChecked((c) => ({ ...c, [itemId]: value }));
    setError(null);
    try {
      const res = await fetch("/api/manager/checklists/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, checked: value }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setChecked((c) => ({ ...c, [itemId]: !value })); // roll back on failure
      setError("Could not save that tick — check your connection and try again.");
    }
  }

  function patchList(id: string, next: Partial<Checklist>) {
    setLists((ls) => ls.map((l) => (l.id === id ? { ...l, ...next } : l)));
  }

  async function saveDefinitions() {
    setBusy(true);
    setError(null);
    const cleaned = lists
      .map((l) => ({ ...l, name: l.name.trim(), items: l.items.filter((i) => i.text.trim()) }))
      .filter((l) => l.name.trim());
    try {
      const res = await fetch("/api/manager/checklists", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lists: cleaned }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save. Try again.");
      setLists((data as { lists: Checklist[] }).lists);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const newId = () => `tmp-${Math.random().toString(36).slice(2)}`; // server re-issues real ids

  return (
    <>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        {editing ? (
          <>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setLists((ls) => [...ls, { id: newId(), name: "", items: [{ id: newId(), text: "" }] }])}
            >
              + Add checklist
            </button>
            <button type="button" className="btn" onClick={saveDefinitions} disabled={busy}>
              {busy ? "Saving…" : "Save checklists"}
            </button>
            <button type="button" className="link-button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-outline" onClick={() => setEditing(true)}>
            Edit checklists
          </button>
        )}
        {error && <span className="field-error">{error}</span>}
      </div>

      {lists.length === 0 && !editing && (
        <p className="mgr-empty">No checklists yet — click “Edit checklists” to create your first (e.g. “Cipher Room reset”).</p>
      )}

      <div className={`chk-grid${editing ? " editing" : ""}`}>
        {lists.map((list) => {
          const done = list.items.filter((i) => checked[i.id]).length;
          return (
            <div className={`mgr-card${editing ? " chk-edit" : ""}`} key={list.id}>
              {editing ? (
                <>
                  <input
                    type="text"
                    className="chk-name-input"
                    value={list.name}
                    onChange={(e) => patchList(list.id, { name: e.target.value })}
                    placeholder="Checklist name, e.g. Opening"
                    aria-label="Checklist name"
                  />
                  <div className="chk-edit-tasks">
                    {list.items.map((item, idx) => (
                      <div key={item.id} className="chk-task-row">
                        <input
                          type="text"
                          value={item.text}
                          onChange={(e) =>
                            patchList(list.id, {
                              items: list.items.map((i) => (i.id === item.id ? { ...i, text: e.target.value } : i)),
                            })
                          }
                          placeholder={`Task ${idx + 1}`}
                          aria-label="Task text"
                        />
                        <button
                          type="button"
                          className="chk-remove"
                          aria-label="Remove task"
                          title="Remove task"
                          onClick={() => patchList(list.id, { items: list.items.filter((i) => i.id !== item.id) })}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="chk-edit-foot">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => patchList(list.id, { items: [...list.items, { id: newId(), text: "" }] })}
                    >
                      + Add task
                    </button>
                    <button
                      type="button"
                      className="link-button danger"
                      onClick={() => setLists((ls) => ls.filter((l) => l.id !== list.id))}
                    >
                      Delete checklist
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="intg-head">
                    <h2>{list.name}</h2>
                    <span className={`mgr-pill${done === list.items.length && list.items.length > 0 ? " on" : ""}`}>
                      {done}/{list.items.length} done
                    </span>
                  </div>
                  <ul className="chk-items">
                    {list.items.map((item) => (
                      <li key={item.id}>
                        <label className="intg-toggle" style={{ fontWeight: 400 }}>
                          <input
                            type="checkbox"
                            checked={!!checked[item.id]}
                            onChange={(e) => toggle(item.id, e.target.checked)}
                          />
                          <span className={checked[item.id] ? "chk-done" : undefined}>{item.text}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
