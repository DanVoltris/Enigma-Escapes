"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatTimestamp } from "@/lib/format";
import type { StaffNote } from "@/lib/types";

export default function StaffNotes({ notes }: { notes: StaffNote[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save the note.");
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the note.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/manager/notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setError("Could not delete that note.");
    }
  }

  return (
    <div className="mgr-card">
      <h2>Staff notes</h2>
      <p className="card-sub">Quick reminders for the team. Everyone with portal access sees these.</p>

      {error && <div className="error-banner">{error}</div>}

      <form className="mgr-inline-form" onSubmit={add} style={{ marginBottom: 18 }}>
        <div className="field" style={{ flex: 1, minWidth: 240 }}>
          <label htmlFor="note" className="sr-only-label">
            New note
          </label>
          <input
            id="note"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Vault 77 prop needs resetting after 3pm"
            maxLength={500}
            style={{ width: "100%" }}
          />
        </div>
        <button type="submit" className="btn" disabled={busy || !text.trim()}>
          {busy ? "Adding…" : "Add note"}
        </button>
      </form>

      {notes.length === 0 ? (
        <p className="mgr-empty">No notes yet.</p>
      ) : (
        <ul className="mgr-notes">
          {notes.map((n) => (
            <li key={n.id}>
              <div>
                <div>{n.note}</div>
                {/* Timestamp formatting differs between the server (Node) and browser
                    ICU data, so suppress the harmless hydration text mismatch. */}
                <div className="when" suppressHydrationWarning>
                  {formatTimestamp(n.createdAt)}
                </div>
              </div>
              <button type="button" className="link-button danger" onClick={() => remove(n.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
