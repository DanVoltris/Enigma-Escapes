"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NoShowToggle({ id, initial }: { id: string; initial: boolean }) {
  const router = useRouter();
  const [noShow, setNoShow] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const next = !noShow;
    try {
      const res = await fetch(`/api/manager/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noShow: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update.");
      setNoShow(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span className={`mgr-pill${noShow ? "" : " on"}`}>{noShow ? "Marked no-show" : "Attending"}</span>
        <button type="button" className="btn btn-outline" onClick={toggle} disabled={busy}>
          {busy ? "Saving…" : noShow ? "Mark as attending" : "Mark as no-show"}
        </button>
      </div>
      {error && <p className="field-error" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
