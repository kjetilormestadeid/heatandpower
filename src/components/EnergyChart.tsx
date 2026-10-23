import { useEffect, useState } from 'react';
import { api } from '../api';
import type { HouseStatistics, StatItem } from '../types';
import { fmtKwh, fmtMoney, statStart } from '../format';
import { Icon } from './Icon';

const H = 180;
const PAD = { top: 12, right: 8, bottom: 22, left: 44 };

export function EnergyChart({ houseId }: { houseId: string }) {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [stats, setStats] = useState<HouseStatistics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    setStats(null);
    setError(null);
    api.houseStatistics(houseId, ym.year, ym.month).then(setStats, (e) => setError(e.message));
  }, [houseId, ym.year, ym.month]);

  function shift(delta: number) {
    const d = new Date(ym.year, ym.month - 1 + delta, 1);
    setYm({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  const isCurrent = ym.year === now.getFullYear() && ym.month === now.getMonth() + 1;
  const monthLabel = new Date(ym.year, ym.month - 1, 1).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });

  const items: StatItem[] = stats?.energyUsage.items ?? [];

  return (
    <section className="card energy">
      <div className="section-head">
        <h2>Strømforbruk per dag (Mill-enheter)</h2>
        <div className="spacer" />
        <button aria-label="Forrige måned" onClick={() => shift(-1)}><Icon name="chevron-left" /></button>
        <span className="month">{monthLabel}</span>
        <button aria-label="Neste måned" onClick={() => shift(1)} disabled={isCurrent}><Icon name="chevron-right" /></button>
      </div>

      {error && <p className="error small">{error}</p>}
      {!stats && !error && <p className="muted small">Henter statistikk…</p>}

      {stats && (
        <>
          <div className="tiles">
            <div className="tile">
              <span className="muted small">Totalt</span>
              <strong>{fmtKwh(stats.valueTotal)}</strong>
            </div>
            <div className="tile">
              <span className="muted small">Kostnad</span>
              <strong>{fmtMoney(stats.electricityPriceTotal)} kr</strong>
            </div>
            {stats.pricePerKWhAvg != null && (
              <div className="tile">
                <span className="muted small">Snittpris</span>
                <strong>{fmtMoney(stats.pricePerKWhAvg)} kr/kWh</strong>
              </div>
            )}
          </div>

          {items.length > 0 ? (
            <Bars items={items} hover={hover} setHover={setHover} />
          ) : (
            <p className="muted small">Ingen data for denne måneden.</p>
          )}

          <button className="link" onClick={() => setShowTable((s) => !s)}>
            {showTable ? 'Skjul tabell' : 'Vis som tabell'}
          </button>
          {showTable && (
            <table className="data">
              <thead>
                <tr>
                  <th>Rom</th>
                  <th>Forbruk</th>
                  <th>Andel</th>
                </tr>
              </thead>
              <tbody>
                {stats.roomList.map((r) => (
                  <tr key={r.roomId}>
                    <td>{r.roomName}</td>
                    <td>{fmtKwh(r.valueTotal)}</td>
                    <td>{Math.round(r.percent)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

function Bars({
  items,
  hover,
  setHover,
}: {
  items: StatItem[];
  hover: number | null;
  setHover: (i: number | null) => void;
}) {
  const W = 720;
  const max = niceMax(Math.max(...items.map((i) => i.value), 1));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / items.length;
  const barW = Math.max(2, slot - 2); // 2px gap mellom søyler
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const hovered = hover != null ? items[hover] : null;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Strømforbruk per dag" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
              {(t / 1000).toLocaleString('nb-NO', { maximumFractionDigits: 1 })}
            </text>
          </g>
        ))}
        <text className="axis" x={4} y={PAD.top - 2}>kWh</text>
        {items.map((it, i) => {
          const x = PAD.left + i * slot + 1;
          const h = Math.max(0, PAD.top + innerH - y(it.value));
          const day = statStart(it).getDate();
          return (
            <g key={it.startTimestamp} onMouseEnter={() => setHover(i)}>
              <rect className="hit" x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} />
              {h > 0 && <path className={`bar ${hover === i ? 'active' : ''}`} d={roundedTop(x, y(it.value), barW, h, Math.min(4, barW / 2))} />}
              {(day === 1 || day % 5 === 0) && (
                <text className="axis" x={x + barW / 2} y={H - 6} textAnchor="middle">
                  {day}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className="tooltip" style={{ left: `${((PAD.left + (hover! + 0.5) * slot) / W) * 100}%` }}>
          <div className="muted small">
            {statStart(hovered).toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
          <strong>{fmtKwh(hovered.value)}</strong>
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
