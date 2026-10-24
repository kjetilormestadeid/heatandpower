import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { StatItem, TibberConsumption } from '../types';
import { statStart } from '../format';
import { retryUntilOk } from '../useServicePoll';

const H = 200;
const PAD = { top: 14, right: 8, bottom: 22, left: 44 };

const kwh = (v: number, digits = 1) => `${v.toLocaleString('nb-NO', { maximumFractionDigits: digits })} kWh`;
const pct = (v: number) => `${Math.round(v * 100)} %`;
const kr = (v: number) => `${v.toLocaleString('nb-NO', { maximumFractionDigits: 0 })} kr`;

/** Lokal dato (YYYY-MM-DD) – nøkkelen begge kildene slås sammen på. */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface CompareDay {
  key: string;
  date: Date;
  /** Hele huset, målt av nettselskapet (Tibber), kWh */
  total: number;
  /** Mill-enhetene, kWh */
  mill: number;
  /** Tibbers snittpris for dagen, kr/kWh */
  unitPrice: number | null;
}

/** Slår sammen Tibbers døgnforbruk med Mills døgnstatistikk (Wh) for dager begge har data. */
export function mergeDays(tibber: TibberConsumption[], mill: StatItem[]): CompareDay[] {
  const millByDay = new Map<string, number>();
  const seen = new Set<number>(); // to månedskall kan overlappe – tell hver periode én gang
  for (const it of mill) {
    if (it.lostStatisticData || seen.has(it.startTimestamp)) continue;
    seen.add(it.startTimestamp);
    const k = dayKey(statStart(it));
    millByDay.set(k, (millByDay.get(k) ?? 0) + it.value / 1000);
  }
  return tibber
    .filter((n) => n.consumption != null)
    .map((n) => {
      const date = new Date(n.from);
      return { key: dayKey(date), date, total: n.consumption!, mill: millByDay.get(dayKey(date)) ?? NaN, unitPrice: n.unitPrice };
    })
    .filter((d) => !Number.isNaN(d.mill));
}

/** Sammenligner husets totale forbruk (Tibber) med Mill-ovnenes forbruk, per dag de siste 30 dagene. */
export function ConsumptionCompare({ houseId }: { houseId: string }) {
  const [tibberHomeId, setTibberHomeId] = useState<string | null | undefined>(undefined);
  const [days, setDays] = useState<CompareDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Samme Tibber-hjem som Tibber-seksjonen har valgt
  useEffect(
    () =>
      retryUntilOk(async () => {
        try {
          const s = await api.tibberStatus();
          if (!s.configured) return setTibberHomeId(null);
          const r = await api.tibberHomes();
          const saved = localStorage.getItem('tibber.homeId');
          setTibberHomeId(r.homes.some((h) => h.id === saved) ? saved : (r.homes[0]?.id ?? null));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Fikk ikke kontakt med Tibber');
          throw e;
        }
      }),
    [],
  );

  useEffect(() => {
    if (!tibberHomeId) return;
    setDays(null);
    setError(null);
    return retryUntilOk(() => {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return Promise.all([
        api.tibberOverview(tibberHomeId, 'HOURLY'),
        api.houseStatistics(houseId, prev.getFullYear(), prev.getMonth() + 1),
        api.houseStatistics(houseId, now.getFullYear(), now.getMonth() + 1),
      ]).then(
        ([t, a, b]) => (setDays(mergeDays(t.daily.nodes, [...a.energyUsage.items, ...b.energyUsage.items])), setError(null)),
        (e) => {
          setError(e.message);
          throw e;
        },
      );
    });
  }, [houseId, tibberHomeId]);

  if (tibberHomeId === null || (tibberHomeId === undefined && !error)) return null;

  return (
    <section className="card energy">
      <div className="section-head">
        <h2>Mill vs. hele huset</h2>
        <span className="muted small">siste 30 dager</span>
      </div>
      {error && <p className="error small">{error}</p>}
      {!days && !error && <p className="muted small">Henter fra Tibber og Mill…</p>}
      {days && days.length === 0 && <p className="muted small">Ingen dager med data fra både Tibber og Mill.</p>}
      {days && days.length > 0 && <CompareView days={days} />}
    </section>
  );
}

/** Nøkkeltall + stablet søylegraf for sammenslåtte dager (ren visning, ingen henting). */
export function CompareView({ days }: { days: CompareDay[] }) {
  const sum = useMemo(() => {
    const total = days.reduce((s, d) => s + d.total, 0);
    const mill = days.reduce((s, d) => s + d.mill, 0);
    const priced = days.filter((d) => d.unitPrice != null);
    const millCost = priced.length ? priced.reduce((s, d) => s + d.mill * d.unitPrice!, 0) : null;
    return { total, mill, share: total > 0 ? mill / total : 0, millCost };
  }, [days]);

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <span className="muted small">Hele huset (Tibber)</span>
          <strong>{kwh(sum.total, 0)}</strong>
        </div>
        <div className="tile">
          <span className="muted small">Mill-ovner</span>
          <strong>{kwh(sum.mill, 0)}</strong>
        </div>
        <div className="tile">
          <span className="muted small">Mill-andel</span>
          <strong>{pct(sum.share)}</strong>
        </div>
        {sum.millCost != null && (
          <div className="tile">
            <span className="muted small">Mill-kostnad (estimert)</span>
            <strong>{kr(sum.millCost)}</strong>
          </div>
        )}
      </div>
      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--series-1)' }} />Mill-ovner</span>
        <span><i className="swatch" style={{ background: 'var(--series-2)' }} />Resten av huset</span>
      </div>
      <StackedBars days={days} />
      <p className="muted small" style={{ margin: 0 }}>
        Tibber viser målt forbruk for hele huset fra nettselskapet. Mill-tallene kommer fra ovnene selv, så små avvik er
        normalt. Kostnaden er estimert med Tibbers snittpris per dag.
      </p>
    </>
  );
}

function StackedBars({ days }: { days: CompareDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const max = niceMax(Math.max(...days.map((d) => Math.max(d.total, d.mill)), 0.1));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / days.length;
  const barW = Math.max(1, slot - (slot > 4 ? 2 : 0.5));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const hovered = hover != null ? days[hover] : null;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daglig forbruk: Mill-ovner mot resten av huset" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
              {t.toLocaleString('nb-NO', { maximumFractionDigits: 0 })}
            </text>
          </g>
        ))}
        <text className="axis" x={4} y={PAD.top - 4}>kWh</text>
        {days.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const millH = y(0) - y(d.mill);
          const rest = Math.max(0, d.total - d.mill);
          const restTop = y(d.mill + rest);
          const restH = y(d.mill) - restTop;
          const day = d.date.getDate();
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)}>
              <rect className="hit" x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} />
              {restH > 0 && (
                <path className={`bar rest ${hover === i ? 'active' : ''}`} d={roundedTop(x, restTop, barW, restH, Math.min(4, barW / 2))} />
              )}
              {millH > 0 && (
                <path
                  className={`bar ${hover === i ? 'active' : ''}`}
                  d={restH > 0 ? rect(x, y(d.mill), barW, millH) : roundedTop(x, y(d.mill), barW, millH, Math.min(4, barW / 2))}
                />
              )}
              {(day === 1 || day % 5 === 0) && (
                <text className="axis" x={x + barW / 2} y={H - 6} textAnchor="middle">{day}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div className="tooltip" style={{ left: `${((PAD.left + (hover! + 0.5) * slot) / W) * 100}%` }}>
          <div className="muted small">
            {hovered.date.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
          <strong>{kwh(hovered.total)} totalt</strong>
          <div className="small">
            Mill {kwh(hovered.mill)} ({hovered.total > 0 ? pct(hovered.mill / hovered.total) : '–'})
          </div>
          <div className="small">Resten {kwh(Math.max(0, hovered.total - hovered.mill))}</div>
        </div>
      )}
    </div>
  );
}

function rect(x: number, top: number, w: number, h: number) {
  return `M${x},${top + h} V${top} H${x + w} V${top + h} Z`;
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
