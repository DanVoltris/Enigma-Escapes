"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatMoney } from "@/lib/format";
import type { ProductStats, VoucherProduct } from "@/lib/voucher-products";

type View = "grid" | "list";
type Filter = "all" | "onsale" | "off";

export default function VoucherProducts({
  products,
  stats,
}: {
  products: VoucherProduct[];
  stats: Record<number, ProductStats>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("grid");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Add form
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (filter === "onsale" && !p.active) return false;
      if (filter === "off" && p.active) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.amountCents / 100).toFixed(2).includes(q);
    });
  }, [products, query, filter]);

  const onSale = products.filter((p) => p.active).length;
  const totalSold = Object.values(stats).reduce((s, v) => s + v.issued, 0);
  const totalValue = Object.values(stats).reduce((s, v) => s + v.valueCents, 0);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/manager/voucher-products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not update that voucher.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update that voucher.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/manager/voucher-products/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not remove that voucher.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that voucher.");
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  async function add() {
    setBusyId("new");
    setError(null);
    try {
      const res = await fetch("/api/manager/voucher-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), name: name.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not add that voucher.");
      setAmount("");
      setName("");
      setAdding(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that voucher.");
    } finally {
      setBusyId(null);
    }
  }

  const pending = products.find((p) => p.id === confirmId);

  return (
    <>
      <div className="vch-summary">
        <div>
          <span className="n">{products.length}</span>
          <span className="l">voucher types</span>
        </div>
        <div>
          <span className="n">{onSale}</span>
          <span className="l">on sale online</span>
        </div>
        <div>
          <span className="n">{totalSold.toLocaleString()}</span>
          <span className="l">codes issued</span>
        </div>
        <div>
          <span className="n">{formatMoney(totalValue)}</span>
          <span className="l">issued all-time</span>
        </div>
      </div>

      <div className="mgr-card">
        <div className="vch-toolbar">
          <input
            type="search"
            className="vch-search"
            placeholder="Search voucher types…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search voucher types"
          />
          <div className="vch-filters" role="group" aria-label="Filter voucher types">
            {(["all", "onsale", "off"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                className={`vch-chip${filter === f ? " on" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : f === "onsale" ? "On sale" : "Off sale"}
              </button>
            ))}
          </div>
          <div className="vch-views" role="group" aria-label="View style">
            <button
              type="button"
              className={`vch-chip${view === "grid" ? " on" : ""}`}
              onClick={() => setView("grid")}
            >
              Grid
            </button>
            <button
              type="button"
              className={`vch-chip${view === "list" ? " on" : ""}`}
              onClick={() => setView("list")}
            >
              List
            </button>
          </div>
        </div>

        {error && <p className="field-error">{error}</p>}

        <div className="vch-save" style={{ marginTop: 10 }}>
          {adding ? (
            <>
              <div className="field" style={{ maxWidth: 150, marginBottom: 0 }}>
                <label htmlFor="vp-amount">Amount ($)</label>
                <input
                  id="vp-amount"
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="field" style={{ maxWidth: 260, marginBottom: 0 }}>
                <label htmlFor="vp-name">Name (optional)</label>
                <input
                  id="vp-name"
                  type="text"
                  value={name}
                  placeholder="Gift Voucher for $X"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <button type="button" className="btn" onClick={add} disabled={busyId === "new" || amount === ""}>
                {busyId === "new" ? "Adding…" : "Add voucher"}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setAdding(true)}>
              + New voucher type
            </button>
          )}
        </div>

        <p className="card-sub">
          {shown.length} of {products.length} types
        </p>

        {shown.length === 0 ? (
          <p className="mgr-empty">Nothing matches that.</p>
        ) : view === "grid" ? (
          <div className="vp-grid">
            {shown.map((p) => {
              const s = stats[p.amountCents] ?? { issued: 0, spent: 0, valueCents: 0 };
              return (
                <div key={p.id} className={`vp-card${p.active ? "" : " off"}`}>
                  <div className="vp-head">
                    <label className="vp-switch" title={p.active ? "On sale" : "Off sale"}>
                      <input
                        type="checkbox"
                        checked={p.active}
                        disabled={busyId === p.id}
                        onChange={() => patch(p.id, { active: !p.active })}
                      />
                      <span>{p.active ? "On sale" : "Off sale"}</span>
                    </label>
                    <button
                      type="button"
                      className="vp-remove"
                      onClick={() => setConfirmId(p.id)}
                      disabled={busyId === p.id}
                      aria-label={`Remove ${p.name}`}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="vp-amount">{formatMoney(p.amountCents)}</div>
                  <div className="vp-name">{p.name}</div>
                  {p.description && <p className="vp-desc">{p.description}</p>}
                  <div className="vp-stats">
                    <span title="Codes issued at this amount">{s.issued} issued</span>
                    <span title="Fully spent">{s.spent} spent</span>
                    <span title="Combined face value">{formatMoney(s.valueCents)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mgr-table-wrap">
            <table className="mgr-table">
              <thead>
                <tr>
                  <th>Voucher</th>
                  <th className="num">Amount</th>
                  <th className="num">Issued</th>
                  <th className="num">Spent</th>
                  <th className="num">Value</th>
                  <th style={{ width: 120 }}>On sale</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const s = stats[p.amountCents] ?? { issued: 0, spent: 0, valueCents: 0 };
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="num">{formatMoney(p.amountCents)}</td>
                      <td className="num">{s.issued}</td>
                      <td className="num">{s.spent}</td>
                      <td className="num">{formatMoney(s.valueCents)}</td>
                      <td>
                        <button
                          type="button"
                          className={`vch-toggle${p.active ? " on" : ""}`}
                          onClick={() => patch(p.id, { active: !p.active })}
                          disabled={busyId === p.id}
                        >
                          {p.active ? "On sale" : "Off sale"}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="vp-remove"
                          onClick={() => setConfirmId(p.id)}
                          disabled={busyId === p.id}
                          aria-label={`Remove ${p.name}`}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pending !== undefined}
        title="Remove this voucher type?"
        confirmLabel="Remove"
        busy={busyId === confirmId}
        onConfirm={() => pending && remove(pending.id)}
        onCancel={() => setConfirmId(null)}
      >
        {pending && (
          <p>
            <strong>{pending.name}</strong> comes off the shop. Codes already sold at{" "}
            {formatMoney(pending.amountCents)} keep their balances — customers can still spend them.
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
