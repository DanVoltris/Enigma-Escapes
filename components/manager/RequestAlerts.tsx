"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AlertRow = {
  id: string;
  name: string;
  role: string | null; // "Manager" / "Admin" for account rows, null for roster
  phone: string;
  on: boolean;
  locked: boolean; // manager/admin — always on
  source: "account" | "roster";
};

// Who gets a text the moment a booking request lands.
//
// Saved per row as it's changed rather than behind one Save button: this is a
// list of twenty-odd people that gets edited one line at a time, and a page-wide
// save invites someone to change a number, wander off, and never send it.
export default function RequestAlerts({
  rows,
  beingTexted,
}: {
  rows: AlertRow[];
  beingTexted: number; // counted server-side by the function that sends them
}) {
  const router = useRouter();
  const [phones, setPhones] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.id, r.phone]))
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function save(row: AlertRow, patch: { phone?: string; requestAlerts?: boolean }) {
    setBusy(row.id);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/manager/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, source: row.source, ...patch }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((d as { error?: string }).error ?? "Could not save that.");
        return;
      }
      setSaved(row.id);
      router.refresh();
    } catch {
      setError("Could not save that. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const managers = rows.filter((r) => r.source === "account");
  const staff = rows.filter((r) => r.source === "roster");

  // The same person often appears twice — a manager's login account and their
  // line on the roster. They get one text, not two, so the second row says so
  // rather than leaving the count looking wrong.
  const digits = (p: string) => p.replace(/\D/g, "");
  const firstWithNumber = new Map<string, string>();
  for (const r of rows) {
    const key = digits(phones[r.id] ?? "");
    if (key && !firstWithNumber.has(key)) firstWithNumber.set(key, r.name);
  }

  const Row = ({ r }: { r: AlertRow }) => {
    const phone = phones[r.id] ?? "";
    const dirty = phone.trim() !== r.phone.trim();
    // A switch on with no number is the one state that looks fine and does
    // nothing, so it says so rather than failing silently at 11pm.
    const silent = !r.locked && r.on && !phone.trim();
    const owner = firstWithNumber.get(digits(phone));
    const duplicate = Boolean(owner) && owner !== r.name && (r.locked || r.on);
    return (
      <li>
        <div className="body" style={{ width: "100%" }}>
          <div className="alert-row">
            <strong>{r.name}</strong>
            {/* Always rendered, empty for roster rows, so the numbers below the
                managers line up with the numbers above them. */}
            <span>{r.role && <span className="mgr-pill">{r.role}</span>}</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhones({ ...phones, [r.id]: e.target.value })}
              onBlur={() => dirty && save(r, { phone })}
              placeholder="204 555 0134"
              aria-label={`Phone number for ${r.name}`}
            />
            <span className="alert-state">
              {r.locked ? (
                <span className="sub">Always on</span>
              ) : (
                <label className="checkbox-row" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={r.on}
                    disabled={busy === r.id}
                    onChange={(e) => save(r, { requestAlerts: e.target.checked })}
                  />
                  <span>Text me requests</span>
                </label>
              )}
              {busy === r.id && <span className="sub">Saving…</span>}
              {saved === r.id && busy === null && <span className="sub">Saved</span>}
            </span>

            {silent && (
              <div className="when alert-note" style={{ color: "var(--danger)" }}>
                Switched on but no number — nothing will be sent.
              </div>
            )}
            {duplicate && (
              <div className="when alert-note">Same number as {owner} — texted once, not twice.</div>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="mgr-card">
      <h2>Booking request alerts</h2>
      <p className="card-sub">
        Who gets a text the moment a booking request comes in. These are for sessions starting within
        the next few hours and they expire when the session starts, so nobody sees one unless they
        happen to have the Requests tab open. Changes save as you make them.{" "}
        <strong>
          {beingTexted} {beingTexted === 1 ? "person is" : "people are"} being texted right now.
        </strong>
      </p>

      {error && <p className="field-error">{error}</p>}

      <h3 style={{ marginTop: 16 }}>Managers &amp; admins</h3>
      <p className="card-sub">
        Always texted — there&apos;s no switch, because whoever answers for the venue shouldn&apos;t be
        able to mute themselves by accident. To stop the texts, clear the number.
      </p>
      {managers.length === 0 ? (
        <p className="cust-empty">No manager or admin accounts yet.</p>
      ) : (
        <ul className="cust-activity alert-list">
          {managers.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </ul>
      )}

      <h3 style={{ marginTop: 20 }}>Staff</h3>
      <p className="card-sub">
        Anyone on the roster can be added. Switching someone off keeps them on the list — it just
        stops the texts until you switch them back on.
      </p>
      {staff.length === 0 ? (
        <p className="cust-empty">Nobody on the staff list yet.</p>
      ) : (
        <ul className="cust-activity alert-list">
          {staff.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
