"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SingleSelect from "@/components/SingleSelect";
import type { LocaleConfig } from "@/lib/format";
import {
  CURRENCIES,
  DATE_STYLES,
  DECIMALS,
  FIRST_DAYS,
  LANGUAGES,
  TIME_FORMATS,
  TIMEZONES,
} from "@/lib/locale-options";

export default function LocaleForm({ initial }: { initial: LocaleConfig }) {
  const router = useRouter();
  const [c, setC] = useState<LocaleConfig>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(next: Partial<LocaleConfig>) {
    setC({ ...c, ...next });
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/settings/locale", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save. Please try again.");
      setSaved(true);
      router.refresh(); // re-primes the whole app with the new locale
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mgr-card">
        <h2>Locale</h2>
        <p className="card-sub">
          Currency, timezone and formats below apply live across the whole app once saved. Language is English only for
          now.
        </p>
        <div className="mgr-form">
          <div className="field-row-3">
            <div className="field">
              <label>Language</label>
              <SingleSelect
                value={c.language}
                onChange={(v) => patch({ language: v })}
                ariaLabel="Language"
                options={LANGUAGES}
              />
            </div>
            <div className="field">
              <label>Currency</label>
              <SingleSelect
                value={`${c.currencyCode}|${c.currencySymbol}`}
                onChange={(v) => {
                  const [currencyCode, currencySymbol] = v.split("|");
                  patch({ currencyCode, currencySymbol });
                }}
                ariaLabel="Currency"
                options={CURRENCIES}
              />
            </div>
            <div className="field">
              <label>Timezone</label>
              <SingleSelect
                value={c.timezone}
                onChange={(v) => patch({ timezone: v })}
                ariaLabel="Timezone"
                options={TIMEZONES}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mgr-card">
        <h2>Formatting</h2>
        <div className="mgr-form">
          <div className="field-row-3">
            <div className="field">
              <label>Date format</label>
              <SingleSelect
                value={c.dateStyle}
                onChange={(v) => patch({ dateStyle: v as LocaleConfig["dateStyle"] })}
                ariaLabel="Date format"
                options={DATE_STYLES}
              />
            </div>
            <div className="field">
              <label>Time format</label>
              <SingleSelect
                value={c.timeFormat}
                onChange={(v) => patch({ timeFormat: v as LocaleConfig["timeFormat"] })}
                ariaLabel="Time format"
                options={TIME_FORMATS}
              />
            </div>
            <div className="field">
              <label>First day of the week</label>
              <SingleSelect
                value={String(c.firstDay)}
                onChange={(v) => patch({ firstDay: v === "1" ? 1 : 0 })}
                ariaLabel="First day of the week"
                options={FIRST_DAYS}
              />
            </div>
          </div>
          <div className="field-row-3">
            <div className="field">
              <label>Number format</label>
              <SingleSelect
                value={c.decimal}
                onChange={(v) => patch({ decimal: v as LocaleConfig["decimal"] })}
                ariaLabel="Number format"
                options={DECIMALS}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button type="button" className="btn" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save & update"}
        </button>
        {saved && <span className="mgr-pill on">Saved — applied</span>}
        {error && <span className="field-error">{error}</span>}
      </div>
    </>
  );
}
