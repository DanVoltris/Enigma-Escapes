"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddLocationForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not add the location.");
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the location.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mgr-inline-form" onSubmit={submit} noValidate style={{ marginBottom: 20 }}>
      <div className="field">
        <label htmlFor="loc-name">New location</label>
        <input
          id="loc-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Northside"
          style={{ minWidth: 240 }}
        />
      </div>
      <button type="submit" className="btn" disabled={busy || !name.trim()}>
        {busy ? "Adding…" : "+ Add location"}
      </button>
      {error && <span className="field-error">{error}</span>}
    </form>
  );
}
