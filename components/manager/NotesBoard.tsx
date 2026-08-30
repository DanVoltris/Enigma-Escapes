"use client";

import { useEffect, useState } from "react";
import type { EditNote } from "@/lib/edit-notes";
import { formatTimestamp } from "@/lib/format";

// Shared edit-notes board. The author name is remembered per browser so each
// partner types it once.
export default function NotesBoard({ initialNotes }: { initialNotes: EditNote[] }) {
  const [notes, setNotes] = useState<EditNote[]>(initialNotes);
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("vb-note-author");
      if (saved) setAuthor(saved);
    } catch {}
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/edit-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save the note.");
      setNotes((n) => [(data as { note: EditNote }).note, ...n]);
      setText("");
      try {
        window.localStorage.setItem("vb-note-author", author.trim());
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the note.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, done: boolean) {
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, done } : x)));
    const res = await fetch("/api/manager/edit-notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, done }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setNotes((n) => n.map((x) => (x.id === id ? { ...x, done: !done } : x))); // roll back
      setError("Could not update that note — try again.");
    }
  }

  async function remove(id: string) {
    const prev = notes;
    setNotes((n) => n.filter((x) => x.id !== id));
    const res = await fetch("/api/manager/edit-notes", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setNotes(prev);
      setError("Could not delete that note — try again.");
    }
  }

  const open = notes.filter((n) => !n.done);
  const done = notes.filter((n) => n.done);

  return (
    <>
      <form className="mgr-card" onSubmit={add}>
        <div className="mgr-form">
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="nb-author">Your name</label>
            <input id="nb-author" type="text" value={author} maxLength={40} onChange={(e) => setAuthor(e.target.value)} placeholder="e.g. Murad" />
          </div>
          <div className="field" style={{ maxWidth: 640 }}>
            <label htmlFor="nb-text">Note</label>
            <textarea
              id="nb-text"
              rows={3}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Change the Grant Park hours on Sundays / new photo for Alice in Wonderland"
            />
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button type="submit" className="btn" disabled={busy || !author.trim() || !text.trim()}>
              {busy ? "Saving…" : "Add note"}
            </button>
            {error && <span className="field-error">{error}</span>}
          </div>
        </div>
      </form>

      {notes.length === 0 && <p className="mgr-empty">No notes yet — leave the first one for your partner.</p>}

      {open.length > 0 && (
        <div className="mgr-card">
          <h2>Open</h2>
          <ul className="mgr-notes">
            {open.map((n) => (
              <li key={n.id}>
                <div>
                  <div>
                    <strong>{n.author}</strong>: {n.text}
                  </div>
                  <div className="when" suppressHydrationWarning>
                    {formatTimestamp(n.createdAt)}
                  </div>
                </div>
                <span style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
                  <button type="button" className="link-button" onClick={() => toggle(n.id, true)}>
                    Mark done
                  </button>
                  <button type="button" className="link-button danger" onClick={() => remove(n.id)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {done.length > 0 && (
        <div className="mgr-card">
          <h2>Done</h2>
          <ul className="mgr-notes">
            {done.map((n) => (
              <li key={n.id}>
                <div>
                  <div className="chk-done">
                    <strong>{n.author}</strong>: {n.text}
                  </div>
                  <div className="when" suppressHydrationWarning>
                    {formatTimestamp(n.createdAt)}
                  </div>
                </div>
                <span style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0 }}>
                  <button type="button" className="link-button" onClick={() => toggle(n.id, false)}>
                    Reopen
                  </button>
                  <button type="button" className="link-button danger" onClick={() => remove(n.id)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
