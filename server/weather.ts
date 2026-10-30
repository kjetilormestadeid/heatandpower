// Vær fra Meteorologisk institutt (samme data som yr.no): Locationforecast 2.0 for valgte steder.
// Stedssøk og «nærmeste sted» via Kartverkets stedsnavn-API. Stedene lagres i data/weather.json,
// så nettbrettet og andre enheter viser samme sted.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fetchRetry } from './net.ts';

const FILE = path.resolve('data/weather.json');
const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const PLACES_URL = 'https://api.kartverket.no/stedsnavn/v1';
// MET krever en User-Agent som identifiserer appen og gir kontaktinfo
const USER_AGENT = 'heatandpower/0.1 github.com/kjetilormestadeid/heatandpower';

export class WeatherError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Place {
  id: string;
  name: string;
  /** f.eks. «Voss, Vestland» */
  detail: string;
  lat: number;
  lon: number;
}

interface Store {
  places: Place[];
  selectedId: string | null;
}

let store: Store | null = null;

async function load() {
  if (!store) store = existsSync(FILE) ? JSON.parse(await readFile(FILE, 'utf8')) : { places: [], selectedId: null };
  return store!;
}
async function save() {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(store, null, 2));
}

export async function weatherPlaces() {
  return load();
}

/** MET ber om maks 4 desimaler – ellers treffer man ikke cachen deres. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export async function addPlace(p: Omit<Place, 'id'>) {
  const s = await load();
  const lat = round4(p.lat);
  const lon = round4(p.lon);
  let place = s.places.find((x) => x.lat === lat && x.lon === lon);
  if (!place) {
    place = { id: randomUUID(), name: p.name.trim().slice(0, 80) || 'Sted', detail: p.detail.trim().slice(0, 120), lat, lon };
    s.places.push(place);
  }
  s.selectedId = place.id;
  await save();
  return s;
}

export async function selectPlace(id: string) {
  const s = await load();
  if (!s.places.some((p) => p.id === id)) throw new WeatherError(404, 'Ukjent sted');
  s.selectedId = id;
  await save();
  return s;
}

export async function removePlace(id: string) {
  const s = await load();
  s.places = s.places.filter((p) => p.id !== id);
  if (s.selectedId === id) s.selectedId = s.places[0]?.id ?? null;
  await save();
  return s;
}

// --- Stedsnavn (Kartverket) ---

interface StedsnavnHit {
  navneobjekttype: string;
  meterFraPunkt?: number;
  representasjonspunkt: { nord: number; øst: number };
  stedsnavn: { skrivemåte: string; navnestatus: string }[];
  kommuner?: { kommunenavn: string }[];
  fylker?: { fylkesnavn: string }[];
}

export interface PlaceHit {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

async function stedsnavn(endpoint: 'sted' | 'punkt', params: Record<string, string>) {
  const url = new URL(`${PLACES_URL}/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, utkoordsys: '4258' })) url.searchParams.set(k, v);
  const res = await fetchRetry(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new WeatherError(502, `Stedssøk feilet (${res.status})`);
  return ((await res.json()) as { navn?: StedsnavnHit[] }).navn ?? [];
}

const hitName = (h: StedsnavnHit) =>
  (h.stedsnavn.find((n) => n.navnestatus === 'hovednavn') ?? h.stedsnavn[0])?.skrivemåte ?? 'Ukjent';

function toHit(h: StedsnavnHit): PlaceHit {
  const where = [h.kommuner?.[0]?.kommunenavn, h.fylker?.[0]?.fylkesnavn].filter(Boolean).join(', ');
  return {
    name: hitName(h),
    detail: [h.navneobjekttype, where].filter(Boolean).join(' · '),
    lat: round4(h.representasjonspunkt.nord),
    lon: round4(h.representasjonspunkt.øst),
  };
}

// Bebygde steder først i søket, så kommuner – fjell, elver og skjær havner bakerst
const SETTLEMENTS = ['By', 'Tettsted', 'Tettsteddel', 'Tettbebyggelse', 'Bydel', 'Bygd', 'Grend', 'Boligfelt'];
const rank = (h: StedsnavnHit) => {
  const i = SETTLEMENTS.indexOf(h.navneobjekttype);
  return i >= 0 ? 0 : h.navneobjekttype === 'Annen administrativ inndeling' ? 1 : 2;
};

export async function searchPlaces(q: string): Promise<PlaceHit[]> {
  // Eksakte treff først; skrivefeil og delord fanges av fuzzy-søket
  const [exact, fuzzy] = await Promise.all([
    stedsnavn('sted', { sok: q, fuzzy: 'false', treffPerSide: '30', side: '1' }),
    stedsnavn('sted', { sok: q, fuzzy: 'true', treffPerSide: '30', side: '1' }),
  ]);
  const seen = new Set<string>();
  return [...exact.sort((a, b) => rank(a) - rank(b)), ...fuzzy.sort((a, b) => rank(a) - rank(b))]
    .map(toHit)
    .filter((h) => {
      const key = `${h.name}|${h.lat}|${h.lon}`;
      return !seen.has(key) && seen.add(key);
    })
    .slice(0, 10);
}

/**
 * Navn på nærmeste tettsted/bydel til et punkt, f.eks. fra nettleserens posisjon. Kartverket sorterer
 * ikke på avstand og gir maks 500 treff, så vi leter i stadig større ring til vi finner et bebygd sted.
 */
export async function nearestPlace(lat: number, lon: number): Promise<PlaceHit> {
  const fallback = { name: 'Min posisjon', detail: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat: round4(lat), lon: round4(lon) };
  try {
    for (const radius of [1_000, 5_000, 20_000]) {
      const hits = await stedsnavn('punkt', { nord: String(lat), ost: String(lon), koordsys: '4258', radius: String(radius), treffPerSide: '500' });
      const best = hits
        .filter((h) => SETTLEMENTS.includes(h.navneobjekttype))
        .sort((a, b) => (a.meterFraPunkt ?? 0) - (b.meterFraPunkt ?? 0))[0];
      // Været hentes for punktet brukeren faktisk står på, ikke stedsnavnets midtpunkt
      if (best) return { ...fallback, name: hitName(best), detail: `Min posisjon · ${best.navneobjekttype}` };
    }
  } catch {
    // Uten navn er posisjonen fortsatt god nok for varselet
  }
  return fallback;
}

// --- Varsel (MET Locationforecast) ---

interface MetStep {
  time: string;
  data: {
    instant: { details: { air_temperature?: number; wind_speed?: number; wind_from_direction?: number; relative_humidity?: number } };
    next_1_hours?: { summary: { symbol_code: string }; details: { precipitation_amount?: number } };
    next_6_hours?: { summary: { symbol_code: string }; details: { precipitation_amount?: number } };
    next_12_hours?: { summary: { symbol_code: string } };
  };
}

export interface ForecastStep {
  time: string;
  temp: number | null;
  wind: number | null;
  windDir: number | null;
  humidity: number | null;
  /** yr-symbolkode for neste time (eller 6 timer der timesoppløsning mangler) */
  symbol: string | null;
  /** nedbør i mm neste time (eller 6 timer, se `hours`) */
  precip: number | null;
  hours: 1 | 6;
}

export interface Forecast {
  updatedAt: string;
  steps: ForecastStep[];
}

// Respekterer Expires fra MET (typisk 30 min) og bruker If-Modified-Since, slik vilkårene krever
const forecasts = new Map<string, { expires: number; lastModified: string | null; data: Forecast }>();

export async function forecast(lat: number, lon: number): Promise<Forecast> {
  const key = `${round4(lat)},${round4(lon)}`;
  const hit = forecasts.get(key);
  if (hit && Date.now() < hit.expires) return hit.data;

  const url = `${MET_URL}?lat=${round4(lat)}&lon=${round4(lon)}`;
  const headers: Record<string, string> = { 'user-agent': USER_AGENT };
  if (hit?.lastModified) headers['if-modified-since'] = hit.lastModified;
  const res = await fetchRetry(url, { headers, signal: AbortSignal.timeout(20_000) });
  const expires = Date.parse(res.headers.get('expires') ?? '') || Date.now() + 30 * 60_000;

  if (res.status === 304 && hit) {
    hit.expires = expires;
    return hit.data;
  }
  if (!res.ok) {
    if (hit) return hit.data; // gammelt varsel er bedre enn ingenting
    throw new WeatherError(502, `Fikk ikke værvarsel fra MET (${res.status})`);
  }
  const body = (await res.json()) as { properties: { meta: { updated_at: string }; timeseries: MetStep[] } };
  const data: Forecast = {
    updatedAt: body.properties.meta.updated_at,
    steps: body.properties.timeseries.map(({ time, data: d }) => {
      const next = d.next_1_hours ?? d.next_6_hours;
      return {
        time,
        temp: d.instant.details.air_temperature ?? null,
        wind: d.instant.details.wind_speed ?? null,
        windDir: d.instant.details.wind_from_direction ?? null,
        humidity: d.instant.details.relative_humidity ?? null,
        symbol: next?.summary.symbol_code ?? d.next_12_hours?.summary.symbol_code ?? null,
        precip: next?.details.precipitation_amount ?? null,
        hours: d.next_1_hours ? 1 : 6,
      };
    }),
  };
  forecasts.set(key, { expires, lastModified: res.headers.get('last-modified'), data });
  return data;
}
