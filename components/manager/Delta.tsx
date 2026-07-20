import { pctChange } from "@/lib/insights";

// Small period-over-period change indicator. Renders nothing when there's no
// prior data to compare against or the change is negligible.
export default function Delta({ cur, prev, goodWhenUp = true }: { cur: number; prev: number; goodWhenUp?: boolean }) {
  const pct = pctChange(cur, prev);
  if (pct === null || Math.abs(pct) < 0.05) return null;
  const up = pct > 0;
  const good = up === goodWhenUp;
  return (
    <span className={`mgr-delta ${good ? "good" : "bad"}`} title="compared with the previous period of the same length">
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
