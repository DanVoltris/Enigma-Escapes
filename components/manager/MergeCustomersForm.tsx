"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SingleSelect from "@/components/SingleSelect";

type Row = { name: string; email: string; bookings: number };

export default function MergeCustomersForm({ customers }: { customers: Row[] }) {
  const router = useRouter();
  const [toEmail, setToEmail] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const options = useMemo(
    () => customers.map((c) => ({ value: c.email, label: `${c.name} — ${c.email} (${c.bookings})` })),
    [customers]
  );
  const from = customers.find((c) => c.email === fromEmail);
  const to = customers.find((c) => c.email === toEmail);

  async function merge() {
    if (!from || !to || busy) return;
    if (
      !window.confirm(
        `Merge "${from.name}" (${from.email}) INTO "${to.name}" (${to.email})?\n\n` +
          `${from.bookings} booking(s) will be rewritten to ${to.name}'s name and email. This cannot be undone.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/customers/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromEmail, toEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not merge. Try again.");
      setDone((data as { moved: number }).moved);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not merge. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done !== null) {
    return (
      <div className="mgr-card">
        <h2>Merged</h2>
        <p className="card-sub">
          {done} booking(s) moved onto {to?.name ?? "the kept customer"}. The old contact is gone —{" "}
          <a href="/manager/customers">back to Customers</a>.
        </p>
      </div>
    );
  }

  return (
    <div className="mgr-card">
      <div className="mgr-form">
        <div className="field" style={{ maxWidth: 480 }}>
          <label>Keep this customer</label>
          <SingleSelect
            ariaLabel="Customer to keep"
            value={toEmail}
            onChange={setToEmail}
            options={[{ value: "", label: "Choose…" }, ...options.filter((o) => o.value !== fromEmail)]}
          />
          <p className="field-hint">Their name, email and phone become the record for all merged bookings.</p>
        </div>
        <div className="field" style={{ maxWidth: 480 }}>
          <label>Merge this one into them</label>
          <SingleSelect
            ariaLabel="Customer to merge away"
            value={fromEmail}
            onChange={setFromEmail}
            options={[{ value: "", label: "Choose…" }, ...options.filter((o) => o.value !== toEmail)]}
          />
          <p className="field-hint">Usually the typo'd duplicate. This contact disappears after the merge.</p>
        </div>
        {from && to && (
          <p className="card-sub">
            <strong>{from.name}</strong> ({from.email}, {from.bookings} booking{from.bookings === 1 ? "" : "s"}) will
            be folded into <strong>{to.name}</strong> ({to.email}). This can&apos;t be undone.
          </p>
        )}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="button" className="btn" onClick={merge} disabled={busy || !from || !to}>
            {busy ? "Merging…" : "Merge customers"}
          </button>
          {error && <span className="field-error">{error}</span>}
        </div>
      </div>
    </div>
  );
}
