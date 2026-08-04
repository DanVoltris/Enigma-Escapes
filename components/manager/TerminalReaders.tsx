"use client";

import { useCallback, useEffect, useState } from "react";
import SingleSelect from "@/components/SingleSelect";

type Reader = { id: string; label: string; status: string; deviceType: string };

// Settings → Payments: pair each venue with the card reader standing at it,
// so "Send to terminal" wakes the right machine.
export default function TerminalReaders({ locations }: { locations: string[] }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [readers, setReaders] = useState<Reader[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingFor, setSavingFor] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/manager/terminal/readers")
      .then((r) => r.json())
      .then((d) => {
        setConfigured(Boolean(d.configured));
        setReaders(d.readers ?? []);
        setMap(d.map ?? {});
        if (d.error) setError(d.error);
      })
      .catch(() => setError("Could not load readers."));
  }, []);
  useEffect(load, [load]);

  async function pair(location: string, readerId: string) {
    setSavingFor(location);
    setError(null);
    try {
      const res = await fetch("/api/manager/terminal/readers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, readerId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Could not save.");
      setMap(d.map ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSavingFor(null);
    }
  }

  if (configured === null) return <p className="mgr-empty">Loading readers…</p>;

  if (!configured) {
    return (
      <p className="mgr-empty">
        Card readers need Stripe first. Add <code>STRIPE_SECRET_KEY</code> to the environment, then a
        Stripe Terminal reader (e.g. WisePOS E) will show up here to pair with each venue.
      </p>
    );
  }

  return (
    <>
      <p className="card-sub">
        Pair each venue with the reader that sits at it. Staff then press <strong>Send to terminal</strong> on the
        Today screen and the amount appears on that reader for the customer to tap.
      </p>
      {readers.length === 0 ? (
        <p className="mgr-empty">
          No readers registered on your Stripe account yet. Add one in the Stripe Dashboard (Terminal → Readers) —
          a simulated reader works for testing.
        </p>
      ) : (
        <div className="mgr-form">
          {locations.map((loc) => (
            <div className="field" key={loc} style={{ maxWidth: 460 }}>
              <label>{loc}</label>
              <SingleSelect
                ariaLabel={`Reader for ${loc}`}
                value={map[loc] ?? ""}
                onChange={(v) => pair(loc, v)}
                options={[
                  { value: "", label: "No reader paired" },
                  ...readers.map((r) => ({
                    value: r.id,
                    label: `${r.label} — ${r.status}${r.deviceType.includes("simulated") ? " (simulated)" : ""}`,
                  })),
                ]}
              />
              {savingFor === loc && <p className="field-hint">Saving…</p>}
            </div>
          ))}
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
    </>
  );
}
