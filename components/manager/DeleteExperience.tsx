"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Usage = { name: string; total: number; upcoming: number };

// Deleting a room, with the danger scaled to what's actually behind it. The
// counts are fetched when the panel is opened rather than on page load, because
// most visits to this page are an edit, not a delete.
//
// Every guard here is repeated in the API route. This is the explanation; that
// is the boundary.
export default function DeleteExperience({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open_() {
    setOpen(true);
    setError(null);
    setUsage(null);
    try {
      const res = await fetch(`/api/manager/experiences/${encodeURIComponent(id)}`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Could not check this room's bookings.");
        return;
      }
      setUsage(d as Usage);
    } catch {
      setError("Could not check this room's bookings. Check your connection and try again.");
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const q = usage && usage.total > 0 ? `?confirm=${encodeURIComponent(typed)}` : "";
      const res = await fetch(`/api/manager/experiences/${encodeURIComponent(id)}${q}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((d as { error?: string }).error ?? "Could not delete the room.");
        return;
      }
      router.push("/manager/experiences?deleted=1");
      router.refresh();
    } catch {
      setError("Could not delete the room. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mgr-card" style={{ marginTop: 24, borderColor: "var(--danger)" }}>
        <h2>Delete this room</h2>
        <p className="card-sub">
          Removes {name} from the portal and the booking site for good. To stop selling it without
          deleting anything, untick “Visible and bookable” above instead.
        </p>
        <button type="button" className="btn btn-outline" onClick={open_}>
          Delete this room
        </button>
      </div>
    );
  }

  const blocked = usage ? usage.upcoming > 0 : false;
  const needsTyping = usage ? usage.upcoming === 0 && usage.total > 0 : false;
  const nameMatches = typed.trim().toLowerCase() === name.trim().toLowerCase();

  return (
    <div className="mgr-card" style={{ marginTop: 24, borderColor: "var(--danger)" }}>
      <h2>Delete this room</h2>

      {!usage && !error && <p className="sub">Checking what&apos;s booked in it…</p>}
      {error && <p className="field-error">{error}</p>}

      {usage && (
        <>
          {blocked ? (
            <p>
              <strong>
                {usage.upcoming.toLocaleString()} session{usage.upcoming === 1 ? " is" : "s are"} still
                booked in {name}.
              </strong>{" "}
              Move or cancel {usage.upcoming === 1 ? "it" : "them"} first — or untick “Visible and
              bookable” above, which takes the room off sale and leaves every booking where it is.
            </p>
          ) : usage.total > 0 ? (
            <>
              <p>
                Nothing is booked in {name} from today onward, but{" "}
                <strong>
                  {usage.total.toLocaleString()} past booking{usage.total === 1 ? "" : "s"}
                </strong>{" "}
                {usage.total === 1 ? "was" : "were"} played here. They keep their own details —
                customers, prices and references are all unaffected — but those sessions will
                disappear from the Calendar grid and from Reports.
              </p>
              <p className="card-sub">This cannot be undone. Type the room&apos;s name to confirm.</p>
              <div className="field" style={{ maxWidth: 320 }}>
                <label htmlFor="del-confirm">Room name</label>
                <input
                  id="del-confirm"
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={name}
                  autoComplete="off"
                />
              </div>
            </>
          ) : (
            <p>
              Nothing has ever been booked in {name}, so deleting it loses nothing. This cannot be
              undone.
            </p>
          )}
        </>
      )}

      <div className="vch-save" style={{ marginTop: 12 }}>
        {usage && !blocked && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || (needsTyping && !nameMatches)}
            onClick={remove}
          >
            {busy ? "Deleting…" : `Delete ${name}`}
          </button>
        )}
        <button type="button" className="btn btn-outline" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
