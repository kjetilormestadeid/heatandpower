import { useEffect, useState } from 'react';
import { api } from '../api';
import { statStart } from '../format';
import { pollWithBackoff } from '../useServicePoll';

const H = 200;
const PAD = { top: 14, right: 8, bottom: 22, left: 44 };

export interface SumHour {
  hour: number;
  /** Hele huset (Tibber), kWh – null når Tibber ikke har levert timen ennå */
  total: number | null;
  /** Mill-enheter, kWh */
  mill: number;
  /** Elbillading (Easee), kWh */
  ev: number;
}

const kwh = (v: number, digits = 1) => `${v.toLocaleString('nb-NO', { maximumFractionDigits: digits })} kWh`;
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)} %` : '–');

/** Henter dagens timeforbruk fra Tibber, Mill og Easee og viser summen per time. */
export function EnergySum({ houseId }: { houseId: string }) {
  const [hours, setHours] = useState<SumHour[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasTibber, setHasTibber] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isToday = (d: Date) => d >= today && d.getTime() < today.getTime() + 86_400_000;
      const total = new Map<number, number>();
      const mill = new Map<number, number>();
      const ev = new Map<number, number>();
      const add = (m: Map<number, number>, h: number, v: number) => m.set(h, (m.get(h) ?? 0) + v);

      const [tibber, millStats, easee] = await Promise.all([
        api.tibberStatus().then(async (s) => {
          if (!s.configured) return null;
          const { homes } = await api.tibberHomes();
          const saved = localStorage.getItem('tibber.homeId');
          const id = homes.some((h) => h.id === saved) ? saved! : homes[0]?.id;
          return id ? api.tibberOverview(id, 'HOURLY') : null;
        }),
        api.houseStatisticsHourly(houseId, today),
        api.easeeStatus().then(async (s) => {
          if (!s.configured) return [];
          const { chargers } = await api.easeeChargers();
          return Promise.all(chargers.map((c) => api.easeeCharger(c.id).then((d) => d.hourly)));
        }).catch(() => []),
      ]);

      for (const n of tibber?.hourly?.nodes ?? []) {
        const d = new Date(n.from);
        if (isToday(d) && n.consumption != null) add(total, d.getHours(), n.consumption);
      }
      for (const it of millStats.energyUsage.items) {
        const d = statStart(it);
        if (isToday(d) && !it.lostStatisticData) add(mill, d.getHours(), it.value / 1000);
      }
      for (const list of easee) for (const h of list) {
        const d = new Date(h.from);
        if (isToday(d)) add(ev, d.getHours(), h.totalEnergy);
      }
      const last = new Date().getHours();
      if (!cancelled) {
        setHasTibber(Boolean(tibber));
        setHours(
          Array.from({ length: last + 1 }, (_, hour) => ({
            hour,
            total: total.get(hour) ?? null,
            mill: mill.get(hour) ?? 0,
            ev: ev.get(hour) ?? 0,
          })),
        );
        setError(null);
      }
    }
    // Hvert 10. minutt; feiler det, prøves det oftere til tjenestene svarer igjen
    const stop = pollWithBackoff(
      () =>
        load().then(
          () => true,
          (e) => (!cancelled && setError(e instanceof Error ? e.message : 'Kunne ikke hente forbruk'), false),
        ),
      10 * 60_000,
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, [houseId]);

  return (
    <section className="card energy">
      <div className="section-head">
        <h2>Forbruk i dag per time</h2>
        <span className="muted small">{hasTibber ? 'hele huset fordelt på kilde' : 'Mill og elbil (Tibber ikke satt opp)'}</span>
      </div>
      {error && <p className="error small">{error}</p>}
      {!hours && !error && <p className="muted small">Henter fra Tibber, Mill og Easee…</p>}
      {hours && <EnergySumView hours={hours} />}
    </section>
  );
}

/** Ren visning: nøkkeltall og stablede søyler per time (Mill, elbil, annet = Tibber minus resten). */
export function EnergySumView({ hours }: { hours: SumHour[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const rest = (h: SumHour) => (h.total == null ? 0 : Math.max(0, h.total - h.mill - h.ev));
  const sum = (f: (h: SumHour) => number) => hours.reduce((s, h) => s + f(h), 0);
  // Kildene leverer i ulik takt – bruk det største av Tibber og Mill+elbil så andelene aldri passerer 100 %
  const total = sum((h) => Math.max(h.total ?? 0, h.mill + h.ev));
  const mill = sum((h) => h.mill);
  const ev = sum((h) => h.ev);
  const other = sum(rest);
  const pending = hours.filter((h) => h.total == null).length;

  const W = 720;
  const slots = 24;
  const max = niceMax(Math.max(...hours.map((h) => Math.max(h.total ?? 0, h.mill + h.ev)), 0.1));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / slots;
  const barW = Math.max(1, slot - 3);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const hovered = hover != null ? hours[hover] : null;

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <span className="muted small">Totalt i dag</span>
          <strong>{kwh(total, 0)}</strong>
        </div>
        <div className="tile">
          <span className="muted small">Mill-ovner</span>
          <strong>{kwh(mill, 1)} <span className="muted small">{pct(mill, total)}</span></strong>
        </div>
        <div className="tile">
          <span className="muted small">Elbil</span>
          <strong>{kwh(ev, 1)} <span className="muted small">{pct(ev, total)}</span></strong>
        </div>
        <div className="tile">
          <span className="muted small">Annet</span>
          <strong>{kwh(other, 1)} <span className="muted small">{pct(other, total)}</span></strong>
        </div>
      </div>
      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--series-1)' }} />Mill</span>
        <span><i className="swatch" style={{ background: 'var(--series-3)' }} />Elbil</span>
        <span><i className="swatch" style={{ background: 'var(--series-2)' }} />Annet</span>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Forbruk per time i dag fordelt på Mill, elbil og annet" onMouseLeave={() => setHover(null)}>
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">{t.toLocaleString('nb-NO', { maximumFractionDigits: 1 })}</text>
            </g>
          ))}
          <text className="axis" x={4} y={PAD.top - 4}>kWh</text>
          {Array.from({ length: slots }, (_, hour) => hour % 3 === 0 && (
            <text key={hour} className="axis" x={PAD.left + hour * slot + slot / 2} y={H - 6} textAnchor="middle">{String(hour).padStart(2, '0')}</text>
          ))}
          {hours.map((h, i) => {
            const x = PAD.left + h.hour * slot + (slot - barW) / 2;
            // Stables nedenfra: Mill, elbil, annet
            const segs = [
              { v: h.mill, cls: 'bar' },
              { v: h.ev, cls: 'bar ev' },
              { v: rest(h), cls: 'bar rest' },
            ];
            let base = 0;
            const top = segs.reduce((n, s, j) => (s.v > 0 ? j : n), -1);
            return (
              <g key={h.hour} onMouseEnter={() => setHover(i)}>
                <rect className="hit" x={PAD.left + h.hour * slot} y={PAD.top} width={slot} height={innerH} />
                {segs.map((s, j) => {
                  if (s.v <= 0) return null;
                  const y0 = y(base);
                  base += s.v;
                  const y1 = y(base);
                  const d = j === top ? roundedTop(x, y1, barW, y0 - y1, Math.min(3, barW / 2)) : `M${x},${y0} V${y1} H${x + barW} V${y0} Z`;
                  return <path key={j} className={`${s.cls} ${hover === i ? 'active' : ''} ${h.total == null ? 'pending' : ''}`} d={d} />;
                })}
              </g>
            );
          })}
        </svg>
        {hovered && (
          <div className="tooltip" style={{ left: `${((PAD.left + (hovered.hour + 0.5) * slot) / W) * 100}%` }}>
            <div className="muted small">kl. {String(hovered.hour).padStart(2, '0')}–{String(hovered.hour + 1).padStart(2, '0')}</div>
            <strong>{hovered.total != null ? `${kwh(hovered.total)} totalt` : 'Tibber har ikke timen ennå'}</strong>
            <div className="small">Mill {kwh(hovered.mill, 2)}</div>
            <div className="small">Elbil {kwh(hovered.ev, 1)}</div>
            {hovered.total != null && <div className="small">Annet {kwh(rest(hovered))}</div>}
          </div>
        )}
      </div>
      {pending > 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          Tibber leverer timeforbruket litt etter hver time – de siste {pending === 1 ? 'timen' : `${pending} timene`} viser bare Mill og elbil.
        </p>
      )}
    </>
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
