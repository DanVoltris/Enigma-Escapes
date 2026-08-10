"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateLong, formatMoney } from "@/lib/format";
import { voucherTotals, type Voucher } from "@/lib/voucher-types";

type Status = "all" | "active" | "inactive" | "unspent" | "partial" | "spent";
type View = "list" | "grid";

const STATUS_LABEL: Record<Status, string> = {
  all: "All",
  active: "Active",
  inactive: "Inactive",
  unspent: "Untouched",
  partial: "Part-used",
  spent: "Fully spent",
};

// How much of a voucher has been used, for the little progress bar.
function usedPct(v: Voucher): number {
  if (v.faceCents <= 0) return 100;
  return Math.min(100, Math.round(((v.faceCents - v.remainingCents) / v.faceCents) * 100));
}

function matchesStatus(v: Voucher, s: Status): boolean {
  switch (s) {
    case "active":
      return v.active;
    case "inactive":
      return !v.active;
    case "unspent":
      return v.remainingCents >= v.faceCents && v.faceCents > 0;
    case "partial":
      return v.remainingCents > 0 && v.remainingCents < v.faceCents;
    case "spent":
      return v.remainingCents <= 0;
    default:
      return true;
  }
}

const PAGE = 60; // 1,600+ vouchers — render a page at a time, not the lot

export default function VoucherManager({ vouchers }: { vouchers: Voucher[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [view, setView] = useState<View>("list");
  const [shown, setShown] = useState(PAGE);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => voucherTotals(vouchers), [vouchers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vouchers.filter((v) => {
      if (!matchesStatus(v, status)) return false;
      if (!q) return true;
      // Search the code, the buyer and their email — staff get asked for any of them.
      return (
        v.code.toLowerCase().includes(q) ||
        (v.purchaser ?? "").toLowerCase().includes(q) ||
        (v.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [vouchers, query, status]);

  const visible = filtered.slice(0, shown);

  async function toggle(v: Voucher) {
    setBusyCode(v.code);
    setError(null);
    try {
      const res = await fetch(`/api/manager/vouchers/${encodeURIComponent(v.code)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !v.active }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not update that voucher.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that voucher.");
    } finally {
      setBusyCode(null);
    }
  }

  function narrow(next: Status) {
    setStatus(next);
    setShown(PAGE);
  }

  return (
    <>
      <div className="vch-summary">
        <div>
          <span className="n">{totals.total.toLocaleString()}</span>
          <span className="l">vouchers</span>
        </div>
        <div>
          <span className="n">{totals.live.toLocaleString()}</span>
          <span className="l">still spendable</span>
        </div>
        <div>
          <span className="n">{formatMoney(totals.outstanding)}</span>
          <span className="l">outstanding balance</span>
        </div>
        <div>
          <span className="n">{formatMoney(totals.face)}</span>
          <span className="l">issued all-time</span>
        </div>
      </div>

      <div className="mgr-card">
        <div className="vch-toolbar">
          <input
            type="search"
            className="vch-search"
            placeholder="Search a code, name or email…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            aria-label="Search gift vouchers"
          />
          <div className="vch-filters" role="group" aria-label="Filter vouchers">
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`vch-chip${status === s ? " on" : ""}`}
                onClick={() => narrow(s)}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="vch-views" role="group" aria-label="View style">
            <button
              type="button"
              className={`vch-chip${view === "list" ? " on" : ""}`}
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
            >
              List
            </button>
            <button
              type="button"
              className={`vch-chip${view === "grid" ? " on" : ""}`}
              onClick={() => setView("grid")}
              aria-pressed={view === "grid"}
            >
              Grid
            </button>
          </div>
        </div>

        {error && <p className="field-error">{error}</p>}

        <p className="card-sub" style={{ marginTop: 4 }}>
          {filtered.length.toLocaleString()} of {vouchers.length.toLocaleString()} vouchers
          {query.trim() !== "" && <> matching &ldquo;{query.trim()}&rdquo;</>}
        </p>

        {filtered.length === 0 ? (
          <p className="mgr-empty">No vouchers match that. Try a different code or filter.</p>
        ) : view === "list" ? (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Bought by</th>
                  <th className="num">Value</th>
                  <th className="num">Remaining</th>
                  <th style={{ width: 130 }}>Used</th>
                  <th>Issued</th>
                  <th style={{ width: 110 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => (
                  <tr key={v.code}>
                    <td>
                      <Link href={`/manager/vouchers/${encodeURIComponent(v.code)}`} className="vch-code">
                        {v.code}
                      </Link>
                    </td>
                    <td>
                      {v.purchaser ?? <span style={{ color: "var(--text-secondary)" }}>—</span>}
                      {v.email && (
                        <>
                          <br />
                          <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{v.email}</span>
                        </>
                      )}
                    </td>
                    <td className="num">{formatMoney(v.faceCents)}</td>
                    <td className="num">
                      <strong>{formatMoney(v.remainingCents)}</strong>
                    </td>
                    <td>
                      <div className="mgr-meter" title={`${usedPct(v)}% used`}>
                        <div className="fill" style={{ width: `${usedPct(v)}%` }} />
                      </div>
                    </td>
                    <td>{formatDateLong(v.createdAt.slice(0, 10))}</td>
                    <td>
                      <button
                        type="button"
                        className={`vch-toggle${v.active ? " on" : ""}`}
                        onClick={() => toggle(v)}
                        disabled={busyCode === v.code}
                      >
                        {busyCode === v.code ? "…" : v.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="vch-grid">
            {visible.map((v) => (
              <div key={v.code} className={`vch-card${v.active ? "" : " off"}`}>
                <Link href={`/manager/vouchers/${encodeURIComponent(v.code)}`} className="vch-code">
                  {v.code}
                </Link>
                <div className="amt">{formatMoney(v.remainingCents)}</div>
                <div className="sub">
                  of {formatMoney(v.faceCents)} · {formatDateLong(v.createdAt.slice(0, 10))}
                </div>
                <div className="mgr-meter" title={`${usedPct(v)}% used`}>
                  <div className="fill" style={{ width: `${usedPct(v)}%` }} />
                </div>
                {v.purchaser && <div className="who">{v.purchaser}</div>}
                <button
                  type="button"
                  className={`vch-toggle${v.active ? " on" : ""}`}
                  onClick={() => toggle(v)}
                  disabled={busyCode === v.code}
                >
                  {busyCode === v.code ? "…" : v.active ? "Active" : "Inactive"}
                </button>
              </div>
            ))}
          </div>
        )}

        {filtered.length > shown && (
          <button type="button" className="btn btn-outline" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, filtered.length - shown)} more
          </button>
        )}
      </div>
    </>
  );
}
