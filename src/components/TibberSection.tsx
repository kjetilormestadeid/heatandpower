import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { PriceLevel, TibberHomeSummary, TibberOverview, TibberPrice } from '../types';
import { BarChart, type Bar } from './BarChart';
import { retryUntilOk } from '../useServicePoll';

const LEVEL_LABEL: Record<PriceLevel, string> = {
  VERY_CHEAP: 'Veldig billig',
  CHEAP: 'Billig',
  NORMAL: 'Normal',
  EXPENSIVE: 'Dyr',
  VERY_EXPENSIVE: 'Veldig dyr',
};

const ore = (kr: number) => `${(kr * 100).toLocaleString('nb-NO', { maximumFractionDigits: 1 })} øre`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
const dayName = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'i dag';
  if (d.toDateString() === tomorrow.toDateString()) return 'i morgen';
  return d.toLocaleDateString('nb-NO', { weekday: 'long' });
};

export function TibberSection() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [homes, setHomes] = useState<TibberHomeSummary[] | null>(null);
  const [homeId, setHomeId] = useState<string | null>(() => localStorage.getItem('tibber.homeId'));
  const [resolution, setResolution] = useState<'HOURLY' | 'QUARTER_HOURLY'>('HOURLY');
  const [data, setData] = useState<TibberOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState(3);

  useEffect(
    () =>
      retryUntilOk(async () => {
        try {
          const s = await api.tibberStatus();
          setConfigured(s.configured);
          if (!s.configured) return;
          const r = await api.tibberHomes();
          setHomes(r.homes);
          setHomeId((cur) => (cur && r.homes.some((h) => h.id === cur) ? cur : (r.homes[0]?.id ?? null)));
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Fikk ikke kontakt med Tibber');
          throw e;
        }
      }),
    [],
  );

  useEffect(() => {
    if (!homeId) return;
    localStorage.setItem('tibber.homeId', homeId);
    setError(null);
    const load = () => api.tibberOverview(homeId, resolution).then(setData, (e) => setError(e.message));
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, [homeId, resolution]);

  const prices = useMemo(() => {
    const p = data?.currentSubscription?.priceInfo;
    return p ? [...p.today, ...p.tomorrow] : [];
  }, [data]);

  if (configured === null && !error) return null;

  if (configured === false) {
    return (
      <section className="card energy">
        <h2>Tibber</h2>
        <p className="small" style={{ margin: 0 }}>
          Legg inn ditt personlige Tibber-token i <code>.env</code> som <code>TIBBER_TOKEN=…</code>, så vises strømpriser og
          forbruk her. Tokenet lager du på{' '}
          <a href="https://developer.tibber.com/settings/access-token" target="_blank" rel="noreferrer">
            developer.tibber.com
          </a>
          .
        </p>
      </section>
    );
  }

  const current = data?.currentSubscription?.priceInfo.current ?? null;
  const today = data?.currentSubscription?.priceInfo.today ?? [];
  const tomorrow = data?.currentSubscription?.priceInfo.tomorrow ?? [];
  const avgToday = today.length ? today.reduce((s, p) => s + p.total, 0) / today.length : null;
  const slotMin = resolution === 'HOURLY' ? 60 : 15;
  const cheapest = cheapestWindow(prices, Math.round((windowHours * 60) / slotMin));

  return (
    <section className="card energy">
      <div className="section-head">
        <h2>Strømpris (Tibber)</h2>
        {homes && homes.length > 1 && (
          <select value={homeId ?? ''} onChange={(e) => setHomeId(e.target.value)} aria-label="Velg Tibber-hjem">
            {homes.map((h) => (
              <option key={h.id} value={h.id}>{h.appNickname || h.address?.address1 || h.id}</option>
            ))}
          </select>
        )}
        <div className="spacer" />
        <div className="seg-toggle" role="group" aria-label="Oppløsning">
          <button className={resolution === 'HOURLY' ? 'selected' : ''} aria-pressed={resolution === 'HOURLY'} onClick={() => setResolution('HOURLY')}>Time</button>
          <button className={resolution === 'QUARTER_HOURLY' ? 'selected' : ''} aria-pressed={resolution === 'QUARTER_HOURLY'} onClick={() => setResolution('QUARTER_HOURLY')}>15 min</button>
        </div>
      </div>

      {error && <p className="error small">{error}</p>}
      {!data && !error && <p className="muted small">Henter fra Tibber…</p>}
      {data && !data.currentSubscription && <p className="muted small">Hjemmet har ikke et aktivt Tibber-abonnement.</p>}

      {data?.currentSubscription && (
        <>
          <div className="tiles">
            {current && (
              <div className="tile">
                <span className="muted small">Pris nå</span>
                <strong>{ore(current.total)}</strong>
                <span className={`level level-${current.level}`}>{LEVEL_LABEL[current.level]}</span>
              </div>
            )}
            {avgToday != null && (
              <div className="tile">
                <span className="muted small">Snitt i dag</span>
                <strong>{ore(avgToday)}</strong>
              </div>
            )}
            {today.length > 0 && <MinMaxTile label="Billigst i dag" price={minBy(today, (p) => p.total)} />}
            {today.length > 0 && <MinMaxTile label="Dyrest i dag" price={minBy(today, (p) => -p.total)} />}
          </div>

          {prices.length > 0 && (
            <BarChart
              label="Strømpris i dag og i morgen"
              unit="øre"
              formatAxis={(v) => (v * 100).toLocaleString('nb-NO', { maximumFractionDigits: 0 })}
              bars={priceBars(prices, current, slotMin)}
              divider={tomorrow.length ? { index: today.length, label: 'I morgen' } : undefined}
            />
          )}
          {!tomorrow.length && <p className="muted small" style={{ margin: 0 }}>Morgendagens priser kommer vanligvis rundt kl. 13.</p>}

          <div className="cheapest">
            <span>Billigste sammenhengende</span>
            <select value={windowHours} onChange={(e) => setWindowHours(Number(e.target.value))} aria-label="Antall timer">
              {[1, 2, 3, 4, 5, 6, 8].map((h) => <option key={h} value={h}>{h} t</option>)}
            </select>
            <span>fremover:</span>
            {cheapest ? (
              <strong>
                {dayName(cheapest.start.startsAt)} {hhmm(cheapest.start.startsAt)}–{hhmm(cheapest.endIso)} · snitt {ore(cheapest.avg)}
              </strong>
            ) : (
              <span className="muted">ikke nok prisdata</span>
            )}
          </div>

          <Consumption data={data} />
        </>
      )}
    </section>
  );
}

function MinMaxTile({ label, price }: { label: string; price: TibberPrice }) {
  return (
    <div className="tile">
      <span className="muted small">{label}</span>
      <strong>{ore(price.total)}</strong>
      <span className="muted small">kl. {hhmm(price.startsAt)}</span>
    </div>
  );
}

function Consumption({ data }: { data: TibberOverview }) {
  const days = data.daily.nodes.filter((n) => n.consumption != null);
  if (!days.length) return <p className="muted small" style={{ margin: 0 }}>Ingen forbruksdata fra Tibber.</p>;
  const now = new Date();
  const month = days.filter((n) => {
    const d = new Date(n.from);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const kwh = month.reduce((s, n) => s + (n.consumption ?? 0), 0);
  const cost = month.reduce((s, n) => s + (n.cost ?? 0), 0);

  return (
    <>
      <div className="section-head">
        <h3>Forbruk siste 30 dager (målt av nettselskap)</h3>
      </div>
      <div className="tiles">
        <div className="tile">
          <span className="muted small">Denne måneden</span>
          <strong>{kwh.toLocaleString('nb-NO', { maximumFractionDigits: 0 })} kWh</strong>
        </div>
        <div className="tile">
          <span className="muted small">Kostnad denne måneden</span>
          <strong>{cost.toLocaleString('nb-NO', { maximumFractionDigits: 0 })} kr</strong>
        </div>
        {kwh > 0 && (
          <div className="tile">
            <span className="muted small">Snittpris</span>
            <strong>{ore(cost / kwh)}</strong>
          </div>
        )}
      </div>
      <BarChart
        label="Daglig forbruk siste 30 dager"
        unit="kWh"
        formatAxis={(v) => v.toLocaleString('nb-NO', { maximumFractionDigits: 0 })}
        bars={days.map((n) => {
          const d = new Date(n.from);
          return {
            key: n.from,
            value: n.consumption ?? 0,
            tick: d.getDate() === 1 || d.getDate() % 5 === 0 ? String(d.getDate()) : undefined,
            tooltip: (
              <>
                <div className="muted small">{d.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                <strong>{(n.consumption ?? 0).toLocaleString('nb-NO', { maximumFractionDigits: 1 })} kWh</strong>
                {n.cost != null && <div className="small">{n.cost.toLocaleString('nb-NO', { maximumFractionDigits: 2 })} kr</div>}
              </>
            ),
          };
        })}
      />
    </>
  );
}

function priceBars(prices: TibberPrice[], current: TibberPrice | null, slotMin: number): Bar[] {
  const now = Date.now();
  return prices.map((p) => {
    const start = new Date(p.startsAt);
    const isCurrent = current?.startsAt === p.startsAt;
    const past = start.getTime() + slotMin * 60_000 <= now;
    return {
      key: p.startsAt,
      value: p.total,
      tick: start.getMinutes() === 0 && start.getHours() % 3 === 0 ? String(start.getHours()).padStart(2, '0') : undefined,
      state: isCurrent ? 'current' : past ? 'past' : 'normal',
      tooltip: (
        <>
          <div className="muted small">{dayName(p.startsAt)} kl. {hhmm(p.startsAt)}</div>
          <strong>{ore(p.total)}</strong>
          <div className="small">{LEVEL_LABEL[p.level]}</div>
        </>
      ),
    };
  });
}

function minBy<T>(list: T[], f: (x: T) => number): T {
  return list.reduce((a, b) => (f(b) < f(a) ? b : a));
}

/** Billigste sammenhengende vindu på `n` prisperioder som ikke er passert. */
function cheapestWindow(prices: TibberPrice[], n: number) {
  const now = Date.now();
  const slotMs = prices.length > 1 ? new Date(prices[1].startsAt).getTime() - new Date(prices[0].startsAt).getTime() : 3600_000;
  const upcoming = prices.filter((p) => new Date(p.startsAt).getTime() + slotMs > now);
  if (n < 1 || upcoming.length < n) return null;
  let best = { i: 0, sum: Infinity };
  let sum = 0;
  for (let i = 0; i < upcoming.length; i++) {
    sum += upcoming[i].total;
    if (i >= n) sum -= upcoming[i - n].total;
    if (i >= n - 1 && sum < best.sum) best = { i: i - n + 1, sum };
  }
  const start = upcoming[best.i];
  const endIso = new Date(new Date(upcoming[best.i + n - 1].startsAt).getTime() + slotMs).toISOString();
  return { start, endIso, avg: best.sum / n };
}
