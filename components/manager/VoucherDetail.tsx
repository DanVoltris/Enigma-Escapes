"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/format";
import {
  ALL_DAYS,
  DAY_LABELS,
  voucherProblem,
  type DateOption,
  type ItemsScope,
  type RedemptionType,
  type TimeOption,
  type Voucher,
} from "@/lib/voucher-types";

type Room = { id: string; name: string; location: string };

export default function VoucherDetail({
  voucher,
  rooms,
  today,
}: {
  voucher: Voucher;
  rooms: Room[];
  today: string;
}) {
  const router = useRouter();
  const v = voucher;

  const [active, setActive] = useState(v.active);
  const [redemptionType, setRedemptionType] = useState<RedemptionType>(v.redemptionType);
  const [spacesTotal, setSpacesTotal] = useState(v.spacesTotal?.toString() ?? "");
  const [spacesLeft, setSpacesLeft] = useState(v.spacesLeft?.toString() ?? "");
  const [oneTimeUse, setOneTimeUse] = useState(v.oneTimeUse);
  const [itemsScope, setItemsScope] = useState<ItemsScope>(v.itemsScope);
  const [itemIds, setItemIds] = useState<string[]>(v.itemIds);
  const [dateOption, setDateOption] = useState<DateOption>(v.dateOption);
  const [dateFrom, setDateFrom] = useState(v.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(v.dateTo ?? "");
  const [timeOption, setTimeOption] = useState<TimeOption>(v.timeOption);
  const [timeFrom, setTimeFrom] = useState(v.timeFrom ?? "");
  const [timeTo, setTimeTo] = useState(v.timeTo ?? "");
  const [days, setDays] = useState<number[]>(v.daysOfWeek);
  const [exclusions, setExclusions] = useState<string[]>(v.exclusionDates);
  const [newExclusion, setNewExclusion] = useState("");
  const [expiryOn, setExpiryOn] = useState(v.expiryDate !== null);
  const [expiryDate, setExpiryDate] = useState(v.expiryDate ?? "");

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redeem panel
  const [rAmount, setRAmount] = useState("");
  const [rDate, setRDate] = useState("");
  const [rTime, setRTime] = useState("");
  const [rRoom, setRRoom] = useState("");
  const [rBusy, setRBusy] = useState(false);
  const [rMsg, setRMsg] = useState<string | null>(null);
  const [rError, setRError] = useState<string | null>(null);

  function toggleDay(d: number) {
    setSaved(false);
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  }
  function toggleItem(id: string) {
    setSaved(false);
    setItemIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/vouchers/${encodeURIComponent(v.code)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          active,
          redemptionType,
          spacesTotal: spacesTotal === "" ? null : Number(spacesTotal),
          spacesLeft: spacesLeft === "" ? null : Number(spacesLeft),
          oneTimeUse,
          itemsScope,
          itemIds,
          dateOption,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          timeOption,
          timeFrom: timeFrom || null,
          timeTo: timeTo || null,
          daysOfWeek: days,
          exclusionDates: exclusions,
          expiryDate: expiryOn ? expiryDate || null : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save. Try again.");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    setRBusy(true);
    setRError(null);
    setRMsg(null);
    try {
      const res = await fetch(`/api/manager/vouchers/${encodeURIComponent(v.code)}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(rAmount),
          asSpaces: redemptionType === "spaces",
          date: rDate || null,
          time: rTime || null,
          roomId: rRoom || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not redeem.");
      const d = data as { remainingCents: number; spacesLeft: number | null; forfeitedCents: number };
      setRMsg(
        redemptionType === "spaces"
          ? `Redeemed. ${d.spacesLeft} space(s) left.`
          : `Redeemed. ${formatMoney(d.remainingCents)} left` +
            (d.forfeitedCents > 0 ? ` (${formatMoney(d.forfeitedCents)} forfeited — one-time use).` : ".")
      );
      setRAmount("");
      router.refresh();
    } catch (err) {
      setRError(err instanceof Error ? err.message : "Could not redeem.");
    } finally {
      setRBusy(false);
    }
  }

  // Live read of whether the voucher is usable right now, using the same rules
  // the server enforces.
  const nowProblem = voucherProblem(v, { today });

  return (
    <>
      <div className="vch-detail-head">
        <div>
          <code className="vch-code">{v.code}</code>
          <div className="amt">
            {v.redemptionType === "spaces"
              ? `${v.spacesLeft ?? 0} of ${v.spacesTotal ?? 0} spaces left`
              : `${formatMoney(v.remainingCents)} left of ${formatMoney(v.faceCents)}`}
          </div>
          <div className="sub">
            Issued {v.createdAt.slice(0, 10)}
            {v.purchaser && <> · {v.purchaser}</>}
            {v.lastUsedAt && <> · last used {v.lastUsedAt.slice(0, 10)}</>}
          </div>
        </div>
        <div className={`vch-state${nowProblem ? " bad" : " good"}`}>
          {nowProblem ?? "Usable today"}
        </div>
      </div>

      <div className="mgr-card">
        <h2>Status</h2>
        <p className="card-sub">An inactive voucher can&apos;t be redeemed, but stays on the books.</p>
        <label className="intg-toggle">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => {
              setActive(e.target.checked);
              setSaved(false);
            }}
          />
          Voucher is active
        </label>
      </div>

      <div className="mgr-card">
        <h2>Value</h2>
        <p className="card-sub">How this voucher is spent when a customer redeems it.</p>
        <div className="vch-row">
          <div className="field">
            <label htmlFor="rtype">Redemption type</label>
            <select
              id="rtype"
              value={redemptionType}
              onChange={(e) => {
                setRedemptionType(e.target.value as RedemptionType);
                setSaved(false);
              }}
            >
              <option value="value">Value amount</option>
              <option value="spaces">Spaces</option>
            </select>
          </div>
          {redemptionType === "value" ? (
            <div className="field">
              <label>Value amount ($)</label>
              <input value={(v.faceCents / 100).toFixed(2)} disabled />
              <p className="field-hint">
                Face value is fixed at issue. {formatMoney(v.remainingCents)} still to spend.
              </p>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="sp-total">Spaces (total)</label>
                <input
                  id="sp-total"
                  type="number"
                  min="0"
                  value={spacesTotal}
                  onChange={(e) => {
                    setSpacesTotal(e.target.value);
                    setSaved(false);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="sp-left">Spaces left</label>
                <input
                  id="sp-left"
                  type="number"
                  min="0"
                  value={spacesLeft}
                  onChange={(e) => {
                    setSpacesLeft(e.target.value);
                    setSaved(false);
                  }}
                />
              </div>
            </>
          )}
        </div>
        <label className="intg-toggle">
          <input
            type="checkbox"
            checked={oneTimeUse}
            onChange={(e) => {
              setOneTimeUse(e.target.checked);
              setSaved(false);
            }}
          />
          This voucher can only be redeemed as a one time use, regardless of any remaining value unused
        </label>
      </div>

      <div className="mgr-card">
        <h2>Items</h2>
        <p className="card-sub">Which experiences this voucher can be spent on.</p>
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor="scope">Select option</label>
          <select
            id="scope"
            value={itemsScope}
            onChange={(e) => {
              setItemsScope(e.target.value as ItemsScope);
              setSaved(false);
            }}
          >
            <option value="all">Apply to all items</option>
            <option value="selected">Apply to selected items</option>
          </select>
        </div>
        {itemsScope === "selected" && (
          <div className="vch-items">
            {rooms.map((r) => (
              <label key={r.id} className="vch-check">
                <input type="checkbox" checked={itemIds.includes(r.id)} onChange={() => toggleItem(r.id)} />
                {r.name} <span style={{ color: "var(--text-secondary)" }}>· {r.location}</span>
              </label>
            ))}
            {rooms.length === 0 && <p className="mgr-empty">No active experiences to choose from.</p>}
          </div>
        )}
      </div>

      <div className="mgr-card">
        <h2>Event dates and times</h2>
        <p className="card-sub">When the session being paid for can take place.</p>

        <div className="vch-row">
          <div className="field">
            <label htmlFor="dopt">Select date option</label>
            <select
              id="dopt"
              value={dateOption}
              onChange={(e) => {
                setDateOption(e.target.value as DateOption);
                setSaved(false);
              }}
            >
              <option value="any">Available any dates</option>
              <option value="range">Available between dates</option>
            </select>
          </div>
          {dateOption === "range" && (
            <>
              <div className="field">
                <label htmlFor="dfrom">From</label>
                <input
                  id="dfrom"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setSaved(false);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="dto">To</label>
                <input
                  id="dto"
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setSaved(false);
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div className="vch-row">
          <div className="field">
            <label htmlFor="topt">Select time option</label>
            <select
              id="topt"
              value={timeOption}
              onChange={(e) => {
                setTimeOption(e.target.value as TimeOption);
                setSaved(false);
              }}
            >
              <option value="any">Available any time</option>
              <option value="range">Available between times</option>
            </select>
          </div>
          {timeOption === "range" && (
            <>
              <div className="field">
                <label htmlFor="tfrom">Earliest start</label>
                <input
                  id="tfrom"
                  type="time"
                  value={timeFrom}
                  onChange={(e) => {
                    setTimeFrom(e.target.value);
                    setSaved(false);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="tto">Latest start</label>
                <input
                  id="tto"
                  type="time"
                  value={timeTo}
                  onChange={(e) => {
                    setTimeTo(e.target.value);
                    setSaved(false);
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div className="field">
          <label>Apply days of the week</label>
          <div className="vch-days">
            {ALL_DAYS.map((d) => (
              <label key={d} className="vch-check">
                <input type="checkbox" checked={days.includes(d)} onChange={() => toggleDay(d)} />
                {DAY_LABELS[d]}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="excl">Exclusion dates</label>
          <div className="vch-row">
            <input
              id="excl"
              type="date"
              value={newExclusion}
              onChange={(e) => setNewExclusion(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                if (!newExclusion || exclusions.includes(newExclusion)) return;
                setExclusions((c) => [...c, newExclusion].sort());
                setNewExclusion("");
                setSaved(false);
              }}
            >
              Add date
            </button>
          </div>
          {exclusions.length > 0 && (
            <div className="vch-chips">
              {exclusions.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="vch-chip on"
                  onClick={() => {
                    setExclusions((c) => c.filter((x) => x !== d));
                    setSaved(false);
                  }}
                  title="Remove"
                >
                  {d} ✕
                </button>
              ))}
            </div>
          )}
          <p className="field-hint">Specific days the voucher can&apos;t be used — blackout dates, private events.</p>
        </div>
      </div>

      <div className="mgr-card">
        <h2>Expiry</h2>
        <p className="card-sub">A specific date after which this voucher can no longer be redeemed.</p>
        <div className="vch-row">
          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="eopt">Expiry options</label>
            <select
              id="eopt"
              value={expiryOn ? "date" : "none"}
              onChange={(e) => {
                setExpiryOn(e.target.value === "date");
                setSaved(false);
              }}
            >
              <option value="none">Gift voucher has no expiry date</option>
              <option value="date">Expires on a set date</option>
            </select>
          </div>
          {expiryOn && (
            <div className="field">
              <label htmlFor="edate">Expires on</label>
              <input
                id="edate"
                type="date"
                value={expiryDate}
                onChange={(e) => {
                  setExpiryDate(e.target.value);
                  setSaved(false);
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="vch-save">
        <button type="button" className="btn" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save & Update"}
        </button>
        {saved && <span className="mgr-pill on">Saved</span>}
        {error && <span className="field-error">{error}</span>}
      </div>

      <div className="mgr-card">
        <h2>Redeem</h2>
        <p className="card-sub">
          Spend against this voucher. Every rule above is checked before anything comes off the balance — fill in the
          session details to check them properly.
        </p>
        <div className="vch-row">
          <div className="field">
            <label htmlFor="ra">{redemptionType === "spaces" ? "Spaces" : "Amount ($)"}</label>
            <input
              id="ra"
              type="number"
              min="0"
              step={redemptionType === "spaces" ? "1" : "0.01"}
              value={rAmount}
              onChange={(e) => setRAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="rd">Session date</label>
            <input id="rd" type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rt">Start time</label>
            <input id="rt" type="time" value={rTime} onChange={(e) => setRTime(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rr">Experience</label>
            <select id="rr" value={rRoom} onChange={(e) => setRRoom(e.target.value)}>
              <option value="">Any</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={redeem} disabled={rBusy || rAmount === ""}>
            {rBusy ? "Redeeming…" : "Redeem"}
          </button>
          {rMsg && <span className="mgr-pill on">{rMsg}</span>}
          {rError && <span className="field-error">{rError}</span>}
        </div>
      </div>
    </>
  );
}
