// Server-safe SVG charts for the Reports tab. No client JS: hover detail comes
// from native <title> tooltips (same idiom as BarChart) and every figure has a
// text alternative (legend counts or a table view alongside).

const NAVY = "#0b2540"; // line ink — high contrast on white
const AREA_FILL = "rgba(135, 206, 250, 0.3)"; // accent tint

export type SeriesPoint = { label: string; value: number; display: string };

// Single-series area chart (sales over time). One series → no legend; the card
// title names it. Hover any day-column for the exact figure.
export function AreaChart({ points, ariaLabel }: { points: SeriesPoint[]; ariaLabel: string }) {
  const W = 720;
  const H = 220;
  const PAD_L = 56;
  const PAD_B = 24;
  const PAD_T = 10;
  const plotW = W - PAD_L - 8;
  const plotH = H - PAD_T - PAD_B;

  const max = Math.max(1, ...points.map((p) => p.value));
  // Round the axis top up to a clean step so gridline labels aren't ragged.
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;

  const x = (i: number) => PAD_L + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (v: number) => PAD_T + plotH - (v / top) * plotH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(PAD_T + plotH).toFixed(1)} L${x(0).toFixed(1)},${(
    PAD_T + plotH
  ).toFixed(1)} Z`;

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: top * f, yy: y(top * f) }));
  // At most ~7 x labels so they never collide.
  const every = Math.max(1, Math.ceil(points.length / 7));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {gridlines.map((g) => (
        <g key={g.v}>
          <line x1={PAD_L} x2={W - 8} y1={g.yy} y2={g.yy} stroke="#e1e5e8" strokeWidth="1" />
          <text x={PAD_L - 8} y={g.yy + 4} textAnchor="end" fontSize="11" fill="#5b6770">
            ${(g.v / 100).toLocaleString("en-CA", { maximumFractionDigits: 0 })}
          </text>
        </g>
      ))}
      {points.length > 1 && <path d={area} fill={AREA_FILL} />}
      {points.length > 1 && <path d={line} fill="none" stroke={NAVY} strokeWidth="2" />}
      {points.map((p, i) => (
        <g key={i}>
          {p.value > 0 && <circle cx={x(i)} cy={y(p.value)} r="3" fill={NAVY} />}
          {/* invisible full-height hover target, wider than the mark */}
          <rect
            x={x(i) - plotW / Math.max(points.length - 1, 1) / 2}
            y={PAD_T}
            width={plotW / Math.max(points.length - 1, 1)}
            height={plotH}
            fill="transparent"
          >
            <title>{p.display}</title>
          </rect>
          {i % every === 0 && (
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#5b6770">
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export type Slice = { label: string; value: number; color: string };

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
}

// Donut with 2px surface gaps between slices and a labelled legend with counts,
// so identity never rides on color alone (the red/green pair sits in the CVD
// floor band and needs this secondary encoding).
export function Donut({ slices, ariaLabel }: { slices: Slice[]; ariaLabel: string }) {
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((s, x) => s + x.value, 0);
  const R = 80;
  const size = R * 2 + 4;

  let angle = -Math.PI / 2;
  const paths = shown.map((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const d = arcPath(size / 2, size / 2, R, angle, angle + sweep);
    angle += sweep;
    return { ...s, d, pct: Math.round((s.value / total) * 100) };
  });

  return (
    <div className="rpt-donut" role="img" aria-label={ariaLabel}>
      {total === 0 ? (
        <p className="cust-empty">Nothing in this period.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${size} ${size}`} style={{ width: 170, height: 170, flexShrink: 0 }}>
            {paths.map((s, i) => (
              <path key={i} d={s.d} fill={s.color} stroke="#fff" strokeWidth="2">
                <title>{`${s.label}: ${s.value} (${s.pct}%)`}</title>
              </path>
            ))}
            {/* donut hole */}
            <circle cx={size / 2} cy={size / 2} r={R * 0.55} fill="#fff" />
          </svg>
          <ul className="rpt-legend">
            {paths.map((s, i) => (
              <li key={i}>
                <span className="chip" style={{ background: s.color }} aria-hidden="true" />
                {s.label}
                <strong>
                  {s.value} · {s.pct}%
                </strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
