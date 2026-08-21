"use client";

// SVG charts for the Reports tab, with a real hover layer (crosshair + tooltip
// div) — native SVG <title> tooltips are unreliable in Safari.

import { useRef, useState } from "react";

const NAVY = "#0b2540"; // line ink — high contrast on white
const AREA_FILL = "rgba(135, 206, 250, 0.28)"; // the accent, as a wash under the line

export type SeriesPoint = { label: string; value: number; display: string };

// The SVG scales to its container's width and takes its height from the aspect
// ratio, so a wide viewBox is what keeps a full-width chart from standing up
// half a metre tall. 1200x260 gives roughly a 4.6:1 band at any width.
const W = 1200;
const H = 260;
const PAD_L = 56;
const PAD_B = 24;
const PAD_T = 10;
const PLOT_W = W - PAD_L - 8;
const PLOT_H = H - PAD_T - PAD_B;

// Single-series area chart (sales over time). One series → no legend; the card
// title names it. Move the pointer across it for a crosshair + exact figures.
export function AreaChart({ points, ariaLabel }: { points: SeriesPoint[]; ariaLabel: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...points.map((p) => p.value));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;

  const x = (i: number) => PAD_L + (points.length === 1 ? PLOT_W / 2 : (i * PLOT_W) / (points.length - 1));
  const y = (v: number) => PAD_T + PLOT_H - (v / top) * PLOT_H;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(PAD_T + PLOT_H).toFixed(1)} L${x(0).toFixed(1)},${(
    PAD_T + PLOT_H
  ).toFixed(1)} Z`;

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: top * f, yy: y(top * f) }));
  const every = Math.max(1, Math.ceil(points.length / 7));

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return;
    const xView = ((e.clientX - rect.left) / rect.width) * W;
    const gap = points.length > 1 ? PLOT_W / (points.length - 1) : PLOT_W;
    const i = Math.round((xView - PAD_L) / gap);
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  const h = hover !== null ? points[hover] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {gridlines.map((g) => (
          <g key={g.v}>
            <line x1={PAD_L} x2={W - 8} y1={g.yy} y2={g.yy} stroke="#eef1f4" strokeWidth="1" />
            <text x={PAD_L - 8} y={g.yy + 4} textAnchor="end" fontSize="11" fill="#5b6770">
              ${(g.v / 100).toLocaleString("en-CA", { maximumFractionDigits: 0 })}
            </text>
          </g>
        ))}
        {points.length > 1 && <path d={area} fill={AREA_FILL} />}
        {points.length > 1 && <path d={line} fill="none" stroke={NAVY} strokeWidth="2" />}
        {points.map(
          (p, i) => p.value > 0 && <circle key={i} cx={x(i)} cy={y(p.value)} r="3" fill={NAVY} pointerEvents="none" />
        )}
        {points.map(
          (p, i) =>
            i % every === 0 && (
              <text key={`t${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#5b6770">
                {p.label}
              </text>
            )
        )}
        {hover !== null && h && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + PLOT_H} stroke={NAVY} strokeWidth="1" strokeDasharray="3,3" />
            {/* 2px surface ring on the highlighted mark */}
            <circle cx={x(hover)} cy={y(h.value)} r="5" fill={NAVY} stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover !== null && h && (
        <div
          className="chart-tip"
          style={{
            left: `${Math.max(12, Math.min(88, (x(hover) / W) * 100))}%`,
            top: `${(y(h.value) / H) * 100}%`,
          }}
        >
          {h.display}
        </div>
      )}
    </div>
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
// floor band and needs this secondary encoding). Hovering a slice shows a
// tooltip and dims the others.
export function Donut({ slices, ariaLabel }: { slices: Slice[]; ariaLabel: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number; i: number } | null>(null);

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

  function onMove(e: React.PointerEvent, i: number) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = paths[i];
    setTip({ text: `${s.label}: ${s.value} (${s.pct}%)`, x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12, i });
  }

  return (
    <div className="rpt-donut" role="img" aria-label={ariaLabel} ref={wrapRef} style={{ position: "relative" }}>
      {total === 0 ? (
        <p className="cust-empty">Nothing in this period.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${size} ${size}`} style={{ width: 170, height: 170, flexShrink: 0 }}>
            {/* One category holding everything sweeps a full turn, and an arc
                whose start and end land on the same point draws nothing — the
                card came out empty but for its legend. A whole ring is a
                circle, not an arc. */}
            {paths.length === 1 ? (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={R}
                fill={paths[0].color}
                onPointerMove={(e) => onMove(e, 0)}
                onPointerLeave={() => setTip(null)}
              />
            ) : (
              paths.map((s, i) => (
              <path
                key={i}
                d={s.d}
                fill={s.color}
                stroke="#fff"
                strokeWidth="2"
                opacity={tip === null || tip.i === i ? 1 : 0.55}
                onPointerMove={(e) => onMove(e, i)}
                onPointerLeave={() => setTip(null)}
              />
              ))
            )}
            <circle cx={size / 2} cy={size / 2} r={R * 0.55} fill="#fff" pointerEvents="none" />
          </svg>
          <ul className="rpt-legend">
            {paths.map((s, i) => (
              <li key={i} style={{ opacity: tip === null || tip.i === i ? 1 : 0.55 }}>
                <span className="chip" style={{ background: s.color }} aria-hidden="true" />
                {s.label}
                <strong>
                  {s.value} · {s.pct}%
                </strong>
              </li>
            ))}
          </ul>
          {tip && (
            <div className="chart-tip" style={{ left: tip.x, top: tip.y, transform: "none" }}>
              {tip.text}
            </div>
          )}
        </>
      )}
    </div>
  );
}
