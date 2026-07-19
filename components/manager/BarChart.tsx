type Bar = { label: string; value: number; displayValue: string };

// Single-series bar chart rendered as plain HTML/CSS (server-safe, no library).
// Exact values appear on hover and are always available to screen readers.
export default function BarChart({ bars, ariaLabel }: { bars: Bar[]; ariaLabel: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="mgr-chart">
        {bars.map((b) => (
          <div
            className="col"
            key={b.label}
            aria-label={`${b.label}: ${b.displayValue}`}
            title={`${b.label}: ${b.displayValue}`}
          >
            <span className="val">{b.displayValue}</span>
            <div className="bar" style={{ height: `${Math.round((b.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mgr-chart-labels" aria-hidden="true">
        {bars.map((b) => (
          <span key={b.label}>{b.label}</span>
        ))}
      </div>
    </div>
  );
}
