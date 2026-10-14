import { useState, type ReactNode } from 'react';

export interface Bar {
  key: string;
  value: number;
  /** Tekst under søylen (vises kun når satt) */
  tick?: string;
  tooltip: ReactNode;
  state?: 'past' | 'current' | 'normal';
}

const H = 180;
const PAD = { top: 14, right: 8, bottom: 22, left: 44 };

/** Enkel søylegraf med én serie, rundet topp, 2px mellomrom og hover-tooltip. */
export function BarChart({
  bars,
  unit,
  formatAxis,
  label,
  divider,
}: {
  bars: Bar[];
  unit: string;
  formatAxis: (v: number) => string;
  label: string;
  /** Indeks der en vertikal skillelinje tegnes (f.eks. midnatt mellom i dag og i morgen) */
  divider?: { index: number; label: string };
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const max = niceMax(Math.max(...bars.map((b) => b.value), 0.0001));
  const min = Math.min(0, ...bars.map((b) => b.value));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / bars.length;
  const barW = Math.max(1, slot - (slot > 4 ? 2 : 0.5));
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;
  const ticks = [min, (max + min) / 2, max];
  const hovered = hover != null ? bars[hover] : null;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
              {formatAxis(t)}
            </text>
          </g>
        ))}
        <text className="axis" x={4} y={PAD.top - 4}>{unit}</text>
        {divider && (
          <g>
            <line className="divider" x1={PAD.left + divider.index * slot} x2={PAD.left + divider.index * slot} y1={PAD.top} y2={PAD.top + innerH} />
            <text className="axis" x={PAD.left + divider.index * slot + 4} y={PAD.top + 8}>{divider.label}</text>
          </g>
        )}
        {bars.map((b, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const top = y(Math.max(b.value, 0));
          const h = Math.abs(y(b.value) - y(0));
          return (
            <g key={b.key} onMouseEnter={() => setHover(i)}>
              <rect className="hit" x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} />
              {h > 0 && (
                <path
                  className={`bar ${b.state ?? ''} ${hover === i ? 'active' : ''}`}
                  d={roundedTop(x, top, barW, h, Math.min(4, barW / 2))}
                />
              )}
              {b.tick && (
                <text className="axis" x={x + barW / 2} y={H - 6} textAnchor="middle">
                  {b.tick}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className="tooltip" style={{ left: `${((PAD.left + (hover! + 0.5) * slot) / W) * 100}%` }}>
          {hovered.tooltip}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, top: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h);
  const bottom = top + h;
  return `M${x},${bottom} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + w - rr} Q${x + w},${top} ${x + w},${top + rr} V${bottom} Z`;
}

function niceMax(v: number) {
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step;
}
