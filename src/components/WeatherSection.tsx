import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Forecast, ForecastStep, PlaceHit, WeatherPlace, WeatherPlaces } from '../types';
import { Icon } from './Icon';
import { OFF, retryUntilOk, useServicePoll } from '../useServicePoll';

// MET oppdaterer varselet omtrent hver halvtime; backenden cacher til Expires
const POLL_MS = 15 * 60_000;
const HOURS = 12;
const DAYS = 6;

// yr-symbolkoder uten _day/_night/_polartwilight -> norsk tekst
const SYMBOL_TEXT: Record<string, string> = {
  clearsky: 'Klarvær',
  fair: 'Lettskyet',
  partlycloudy: 'Delvis skyet',
  cloudy: 'Skyet',
  fog: 'Tåke',
  lightrainshowers: 'Lette regnbyger',
  rainshowers: 'Regnbyger',
  heavyrainshowers: 'Kraftige regnbyger',
  lightrain: 'Lett regn',
  rain: 'Regn',
  heavyrain: 'Kraftig regn',
  lightsleetshowers: 'Lette sluddbyger',
  sleetshowers: 'Sluddbyger',
  heavysleetshowers: 'Kraftige sluddbyger',
  lightsleet: 'Lett sludd',
  sleet: 'Sludd',
  heavysleet: 'Kraftig sludd',
  lightsnowshowers: 'Lette snøbyger',
  snowshowers: 'Snøbyger',
  heavysnowshowers: 'Kraftige snøbyger',
  lightsnow: 'Lett snø',
  snow: 'Snø',
  heavysnow: 'Kraftig snø',
};
export function symbolText(code: string | null) {
  if (!code) return '';
  const base = code.split('_')[0];
  const thunder = base.endsWith('andthunder');
  const text = SYMBOL_TEXT[thunder ? base.slice(0, -'andthunder'.length) : base] ?? base;
  return thunder ? `${text} og torden` : text;
}

const WIND_DIRS = ['nord', 'nordøst', 'øst', 'sørøst', 'sør', 'sørvest', 'vest', 'nordvest'];
const windFrom = (deg: number) => WIND_DIRS[Math.round(deg / 45) % 8];

const num = (v: number, digits = 0) => v.toLocaleString('nb-NO', { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const deg = (v: number | null) => (v == null ? '–' : `${num(v)}°`);
const mm = (v: number) => `${num(v, 1)} mm`;
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });

/** yr sine offisielle værsymboler (metno/weathericons, CC BY 4.0) */
export function WxSymbol({ code, size }: { code: string | null; size: number }) {
  if (!code) return <span style={{ width: size, height: size }} />;
  return (
    <img
      className="wx-symbol"
      src={`https://cdn.jsdelivr.net/gh/metno/weathericons@main/weather/svg/${code}.svg`}
      alt={symbolText(code)}
      title={symbolText(code)}
      width={size}
      height={size}
    />
  );
}

// Hurtigpanelet og værseksjonen henter steder hver for seg; et bytte i den ene sier fra til den andre
const PLACES_EVENT = 'weather-places';

/** Lagrede steder og varsel for valgt sted. Delt av værseksjonen og hurtigpanelet. */
export function useWeather() {
  const [store, setStore] = useState<WeatherPlaces | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stop = retryUntilOk(() =>
      api.weatherPlaces().then(
        (s) => (setStore(s), setError(null)),
        (e) => {
          setError(e.message);
          throw e;
        },
      ),
    );
    const onChange = (e: Event) => setStore((e as CustomEvent<WeatherPlaces>).detail);
    window.addEventListener(PLACES_EVENT, onChange);
    return () => {
      stop();
      window.removeEventListener(PLACES_EVENT, onChange);
    };
  }, []);

  const place = store?.places.find((p) => p.id === store.selectedId) ?? null;
  const { data, down } = useServicePoll<{ placeId: string; forecast: Forecast }>(
    async () => (place ? { placeId: place.id, forecast: await api.forecast(place.lat, place.lon) } : OFF),
    POLL_MS,
    [place?.id],
  );
  // Ikke vis forrige steds varsel mens det nye hentes
  const forecast = data && data.placeId === place?.id ? data.forecast : null;

  async function update(fn: () => Promise<WeatherPlaces>) {
    setError(null);
    try {
      const s = await fn();
      window.dispatchEvent(new CustomEvent(PLACES_EVENT, { detail: s }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke lagre');
    }
  }

  return { store, place, forecast, down, error, update };
}

/** Vær for valgt sted fra MET (yr.no): nå, neste timer og neste dager. Stedet velges med søk eller egen posisjon. */
export function WeatherSection() {
  const { store, place, forecast, down, error, update } = useWeather();
  const [editing, setEditing] = useState(false);
  // Uten lagrede steder åpnes stedsvelgeren med en gang
  useEffect(() => {
    if (store?.places.length === 0) setEditing(true);
  }, [store?.places.length]);

  if (!store && !error) return null;

  return (
    <section className="card energy weather" id="weather">
      <div className="section-head">
        <h2>Vær</h2>
        {store && store.places.length > 1 ? (
          <select value={store.selectedId ?? ''} onChange={(e) => update(() => api.selectWeatherPlace(e.target.value))} aria-label="Velg sted">
            {store.places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          place && <span className="muted">{place.name}</span>
        )}
        <div className="spacer" />
        {store && (
          <button onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            {editing ? 'Ferdig' : 'Steder'}
          </button>
        )}
      </div>

      {error && <p className="error small">{error}</p>}
      {editing && store && (
        <PlacePicker
          places={store.places}
          selectedId={store.selectedId}
          onAdd={(p) => update(() => api.addWeatherPlace(p)).then(() => setEditing(false))}
          onSelect={(id) => update(() => api.selectWeatherPlace(id))}
          onRemove={(id) => update(() => api.removeWeatherPlace(id))}
        />
      )}

      {place && !forecast && !down && <p className="muted small">Henter værvarsel…</p>}
      {place && !forecast && down && <p className="muted small">Fikk ikke kontakt med MET – prøver igjen.</p>}
      {place && forecast && <WeatherView forecast={forecast} place={place} stale={down} />}
    </section>
  );
}

/** Søk etter sted (Kartverket), bruk egen posisjon, og velg/fjern lagrede steder. */
function PlacePicker({
  places,
  selectedId,
  onAdd,
  onSelect,
  onRemove,
}: {
  places: WeatherPlace[];
  selectedId: string | null;
  onAdd: (p: PlaceHit) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Søk mens man skriver, litt forsinket så vi ikke spør for hvert tastetrykk
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setHits(null);
    let stale = false;
    const t = window.setTimeout(() => {
      api.searchWeatherPlaces(term).then(
        (r) => !stale && (setHits(r.places), setMsg(null)),
        (e) => !stale && setMsg(e.message),
      );
    }, 300);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [q]);

  function useMyPosition() {
    if (!navigator.geolocation) return setMsg('Nettleseren støtter ikke posisjon.');
    setBusy(true);
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          onAdd((await api.nearestWeatherPlace(coords.latitude, coords.longitude)).place);
        } catch (e) {
          setMsg(e instanceof Error ? e.message : 'Fant ikke stedet');
        } finally {
          setBusy(false);
        }
      },
      (err) => {
        setBusy(false);
        // Posisjon krever HTTPS (eller localhost) – vanlig feil når siten åpnes via IP på hjemmenettet
        setMsg(
          err.code === err.PERMISSION_DENIED
            ? window.isSecureContext
              ? 'Tilgang til posisjon ble avslått.'
              : 'Posisjon krever HTTPS eller localhost. Søk etter stedet i stedet.'
            : 'Fant ikke posisjonen. Prøv igjen, eller søk etter stedet.',
        );
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  }

  return (
    <div className="wx-picker">
      <div className="wx-search">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Søk etter sted, f.eks. Voss"
          aria-label="Søk etter sted"
          autoFocus={places.length === 0}
        />
        <button onClick={useMyPosition} disabled={busy}>
          {busy ? 'Finner posisjon…' : 'Bruk min posisjon'}
        </button>
      </div>
      {msg && <p className="error small">{msg}</p>}
      {hits && hits.length === 0 && <p className="muted small">Ingen treff.</p>}
      {hits && hits.length > 0 && (
        <ul className="wx-list">
          {hits.map((h) => (
            <li key={`${h.lat},${h.lon},${h.name}`}>
              <button className="wx-hit" onClick={() => onAdd(h)}>
                <strong>{h.name}</strong>
                <span className="muted small">{h.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {places.length > 0 && (
        <>
          <span className="muted small">Lagrede steder</span>
          <ul className="wx-list">
            {places.map((p) => (
              <li key={p.id} className="wx-saved">
                <label>
                  <input type="radio" name="wx-place" checked={p.id === selectedId} onChange={() => onSelect(p.id)} />
                  <strong>{p.name}</strong>
                  <span className="muted small">{p.detail}</span>
                </label>
                <button onClick={() => onRemove(p.id)} aria-label={`Fjern ${p.name}`} title="Fjern">
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

interface Day {
  key: string;
  date: Date;
  min: number;
  max: number;
  precip: number;
  symbol: string | null;
}

/** Slår sammen varselet per kalenderdag: min/maks, nedbør og symbolet midt på dagen. */
function days(steps: ForecastStep[]): Day[] {
  const out = new Map<string, Day & { noonDist: number }>();
  for (const s of steps) {
    const d = new Date(s.time);
    const key = d.toDateString();
    let day = out.get(key);
    if (!day) out.set(key, (day = { key, date: d, min: Infinity, max: -Infinity, precip: 0, symbol: null, noonDist: Infinity }));
    if (s.temp != null) {
      day.min = Math.min(day.min, s.temp);
      day.max = Math.max(day.max, s.temp);
    }
    // Nedbøren gjelder perioden etter tidspunktet; timesteg og 6-timers steg overlapper ikke i MET-serien
    day.precip += s.precip ?? 0;
    const dist = Math.abs(d.getHours() + (s.hours === 6 ? 3 : 0) - 13);
    if (s.symbol && dist < day.noonDist) Object.assign(day, { symbol: s.symbol, noonDist: dist });
  }
  return [...out.values()].filter((d) => d.min !== Infinity);
}

/** Ren visning av varselet (ingen henting). */
export function WeatherView({ forecast, place, stale }: { forecast: Forecast; place: WeatherPlace; stale?: boolean }) {
  const now = Date.now();
  // Første steg er gjeldende time; hopp over steg som er helt passert
  const upcoming = forecast.steps.filter((s) => new Date(s.time).getTime() + 3600_000 > now);
  const cur = upcoming[0];
  if (!cur) return <p className="muted small">Varselet er utdatert.</p>;
  const hourly = upcoming.filter((s) => s.hours === 1).slice(0, HOURS);
  const daily = days(upcoming).slice(0, DAYS);

  return (
    <>
      <div className="wx-now">
        <WxSymbol code={cur.symbol} size={72} />
        <span className={`big ${cur.temp != null && cur.temp < 0 ? 'wx-cold' : 'wx-warm'}`}>{deg(cur.temp)}</span>
        <div className="room-meta">
          <strong>{symbolText(cur.symbol)}</strong>
          {cur.wind != null && (
            <span className="muted">
              Vind {num(cur.wind)} m/s{cur.windDir != null && ` fra ${windFrom(cur.windDir)}`}
            </span>
          )}
          <span className="muted">
            {cur.precip ? `${mm(cur.precip)} nedbør neste ${cur.hours === 1 ? 'time' : '6 timer'}` : 'Opphold neste time'}
            {cur.humidity != null && ` · ${num(cur.humidity)} % fuktighet`}
          </span>
        </div>
      </div>

      {hourly.length > 0 && (
        <div className="wx-hours" role="list" aria-label="Neste timer">
          {hourly.map((s) => (
            <div key={s.time} className="wx-hour" role="listitem">
              <span className="muted small">{hhmm(s.time)}</span>
              <WxSymbol code={s.symbol} size={36} />
              <strong className={s.temp != null && s.temp < 0 ? 'wx-cold' : 'wx-warm'}>{deg(s.temp)}</strong>
              <span className="small wx-precip">{s.precip ? num(s.precip, 1) : ''}</span>
            </div>
          ))}
        </div>
      )}

      {daily.length > 1 && (
        <ul className="wx-days">
          {daily.map((d, i) => (
            <li key={d.key}>
              <span className="wx-day-name">
                {i === 0 ? 'I dag' : i === 1 ? 'I morgen' : d.date.toLocaleDateString('nb-NO', { weekday: 'long' })}
              </span>
              <WxSymbol code={d.symbol} size={32} />
              <span className="wx-range">
                <span className={d.max < 0 ? 'wx-cold' : 'wx-warm'}>{deg(d.max)}</span>
                <span className="muted"> / </span>
                <span className={d.min < 0 ? 'wx-cold' : 'muted'}>{deg(d.min)}</span>
              </span>
              <span className="small wx-precip">{d.precip >= 0.05 ? mm(d.precip) : ''}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="muted small" style={{ margin: 0 }}>
        {place.detail ? `${place.name} (${place.detail}). ` : ''}Varsel fra{' '}
        <a href={`https://www.yr.no/nb/værvarsel/daglig-tabell/${place.lat},${place.lon}`} target="_blank" rel="noreferrer">
          Yr
        </a>{' '}
        / MET Norway, oppdatert {hhmm(forecast.updatedAt)}
        {stale && ' – ingen kontakt nå, viser siste varsel'}
      </p>
    </>
  );
}

// Så mange timer som får plass vises – resten brytes bort i CSS
const QUICK_HOURS = 12;
const showWeatherSection = () =>
  document.getElementById('weather')?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'start' });

/** Kompakt vær på startsiden: nå, de neste timene og valg av sted. Trykk åpner værseksjonen. */
export function QuickWeather() {
  const { store, place, forecast, down, error, update } = useWeather();
  // Vis flisen også når stedene ikke kan hentes, så det synes at noe er galt
  if (!store) {
    if (!error) return null;
    return (
      <div className="quick-weather quick-weather-empty stale">
        <span className="muted small">Vær</span>
        <span className="small">{error}</span>
      </div>
    );
  }

  if (!place) {
    return (
      <button className="quick-weather quick-weather-empty" onClick={showWeatherSection}>
        <span className="muted small">Vær</span>
        <span>Velg sted …</span>
      </button>
    );
  }

  const now = Date.now();
  const upcoming = forecast?.steps.filter((s) => new Date(s.time).getTime() + 3600_000 > now) ?? [];
  const cur = upcoming[0];
  const next = upcoming.slice(1).filter((s) => s.hours === 1).slice(0, QUICK_HOURS);

  return (
    <div className={`quick-weather ${down ? 'stale' : ''}`}>
      <div className="quick-weather-now">
        <button className="quick-weather-open" onClick={showWeatherSection} aria-label="Vis værvarselet">
          <WxSymbol code={cur?.symbol ?? null} size={52} />
          <strong className={cur?.temp != null && cur.temp < 0 ? 'wx-cold' : 'wx-warm'}>{deg(cur?.temp ?? null)}</strong>
        </button>
        <div className="quick-weather-meta">
          {store.places.length > 1 ? (
            <select
              value={store.selectedId ?? ''}
              onChange={(e) => update(() => api.selectWeatherPlace(e.target.value))}
              aria-label="Velg sted for været"
            >
              {store.places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="muted small">{place.name}</span>
          )}
          <span className="small">{cur ? symbolText(cur.symbol) : forecast ? '' : 'Henter …'}</span>
        </div>
      </div>
      {next.length > 0 && (
        <button className="quick-weather-hours" onClick={showWeatherSection} aria-label="Neste timer – vis værvarselet">
          {next.map((s) => (
            <span key={s.time} className="quick-weather-hour">
              <span className="muted small">{hhmm(s.time).slice(0, 2)}</span>
              <WxSymbol code={s.symbol} size={26} />
              <span className={`small ${s.temp != null && s.temp < 0 ? 'wx-cold' : ''}`}>{deg(s.temp)}</span>
            </span>
          ))}
        </button>
      )}
    </div>
  );
}
