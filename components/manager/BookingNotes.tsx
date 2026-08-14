"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BookingNote } from "@/lib/types";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return letters.toUpperCase() || "?";
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

// The Notes card on a booking: staff notes anyone can add, and edit afterwards
// with the pencil. System notes (the legacy-import trail) are shown but have no
// pencil — the server refuses to change them either way.
export default function BookingNotes({
  bookingId,
  notes,
  canEdit,
}: {
  bookingId: string;
  notes: BookingNote[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ordered = [...notes].sort((a, b) => b.at.localeCompare(a.at));

  async function send(method: "POST" | "PATCH", body: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/bookings/${bookingId}/notes`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Could not save. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {ordered.length === 0 ? (
        <p className="cust-empty">No notes have been created yet.</p>
      ) : (
        <ul className="cust-activity">
          {ordered.map((n) => {
            const system = n.author === "System";
            const editing = editingId === n.id;
            return (
              <li key={n.id}>
                <span className="dot" aria-hidden="true">
                  {system ? "!" : initials(n.author)}
                </span>
                <div className="body">
                  {editing ? (
                    <div className="field" style={{ marginBottom: 6 }}>
                      <textarea
                        rows={3}
                        value={draft}
                        maxLength={1200}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditingId(null);
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            e.preventDefault();
                            if (draft.trim()) {
                              void send("PATCH", { noteId: n.id, text: draft.trim() }).then(
                                (ok) => ok && setEditingId(null)
                              );
                            }
                          }
                        }}
                      />
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy || !draft.trim() || draft.trim().length > 1000}
                          onClick={async () => {
                            if (await send("PATCH", { noteId: n.id, text: draft.trim() })) setEditingId(null);
                          }}
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                        <button type="button" className="link-button" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <div style={{ whiteSpace: "pre-wrap", flex: 1 }}>{n.text}</div>
                      {canEdit && !system && (
                        <button
                          type="button"
                          className="link-button"
                          title="Edit this note"
                          aria-label={`Edit the note by ${n.author}`}
                          onClick={() => {
                            setError(null);
                            setDraft(n.text);
                            setEditingId(n.id);
                          }}
                        >
                          ✎
                        </button>
                      )}
                    </div>
                  )}
                  <div className="when">
                    {n.author} · {when(n.at)}
                    {n.editedAt && ` · edited ${when(n.editedAt)}`}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="field-error">{error}</p>}

      {canEdit && (
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="booking-note">Add a note</label>
          <textarea
            id="booking-note"
            rows={3}
            value={adding}
            maxLength={1200}
            placeholder="Anything the next person should know — a phone call, an access need, a card left behind."
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (adding.trim()) void send("POST", { text: adding.trim() }).then((ok) => ok && setAdding(""));
              }
            }}
          />
          <div className="form-actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className="sub">Saved with your name and the time.</span>
            <button
              type="button"
              className="btn"
              disabled={busy || !adding.trim() || adding.trim().length > 1000}
              onClick={async () => {
                if (await send("POST", { text: adding.trim() })) setAdding("");
              }}
            >
              {busy ? "Saving…" : "Add note"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
