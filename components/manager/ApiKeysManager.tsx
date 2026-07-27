"use client";

import { useState } from "react";
import type { ApiKey } from "@/lib/api-keys";

export default function ApiKeysManager({ initialKeys }: { initialKeys: ApiKey[] }) {
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = label.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the key. Try again.");
      setKeys((k) => [...k, data.key as ApiKey]);
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the key. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/manager/keys/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not revoke the key. Try again.");
      setKeys((k) => k.filter((x) => x.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the key. Try again.");
    }
  }

  return (
    <>
      {keys.length === 0 ? (
        <p className="mgr-empty">No partner keys yet — create one below and hand it to the partner.</p>
      ) : (
        <ul className="mgr-notes">
          {keys.map((k) => (
            <li key={k.id}>
              <div>
                <div>
                  <strong>{k.label}</strong>
                </div>
                <div>
                  <code className="key-code">{k.key}</code>
                </div>
                <div className="when" suppressHydrationWarning>
                  Created {new Date(k.createdAt).toLocaleDateString("en-CA", { dateStyle: "medium" })}
                </div>
              </div>
              <button type="button" className="link-button danger" onClick={() => revoke(k.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="promo-form" style={{ maxWidth: 420, marginTop: 14 }}>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Key label, e.g. Morty"
          aria-label="New key label"
        />
        <button type="button" className="btn" onClick={create} disabled={busy || !label.trim()}>
          {busy ? "Creating…" : "Create key"}
        </button>
      </div>
      {error && <p className="field-error" style={{ marginTop: 8 }}>{error}</p>}
    </>
  );
}
