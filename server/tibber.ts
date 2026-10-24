const TIBBER_URL = 'https://api.tibber.com/v1-beta/gql';
const CACHE_MS = 5 * 60_000;

export class TibberError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const tibberConfigured = () => Boolean(process.env.TIBBER_TOKEN);

const cache = new Map<string, { at: number; data: unknown }>();

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.TIBBER_TOKEN;
  if (!token) throw new TibberError(503, 'TIBBER_TOKEN er ikke satt i .env');

  const key = query + JSON.stringify(variables);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as T;

  const res = await fetch(TIBBER_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'mill-dashboard/0.1',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!res.ok || body?.errors?.length || !body?.data) {
    const msg = body?.errors?.map((e) => e.message).join('; ') || `Tibber API ${res.status}`;
    throw new TibberError(res.status === 200 ? 502 : res.status, msg);
  }
  cache.set(key, { at: Date.now(), data: body.data });
  return body.data;
}

const PRICE = 'total energy tax startsAt level currency';

export function tibberHomes() {
  return gql<{ viewer: { homes: { id: string; appNickname: string | null; address: { address1: string | null } | null }[] } }>(
    `{ viewer { homes { id appNickname address { address1 } } } }`,
  ).then((d) => d.viewer.homes);
}

export function tibberOverview(homeId: string, resolution: 'HOURLY' | 'QUARTER_HOURLY') {
  return gql<{ viewer: { home: unknown } }>(
    `query($id: ID!, $res: PriceInfoResolution) {
      viewer { home(id: $id) {
        id timeZone appNickname
        currentSubscription { status priceInfo(resolution: $res) {
          current { ${PRICE} } today { ${PRICE} } tomorrow { ${PRICE} }
        } }
        daily: consumption(resolution: DAILY, last: 31) { nodes { from to cost unitPrice consumption consumptionUnit currency } }
        hourly: consumption(resolution: HOURLY, last: 30) { nodes { from to cost unitPrice consumption consumptionUnit currency } }
      } }
    }`,
    { id: homeId, res: resolution },
  ).then((d) => d.viewer.home);
}

// --- Tibber Pulse: sanntidsmåling via websocket (liveMeasurement) ---

export interface TibberLive {
  timestamp: string;
  /** W forbruk nå */
  power: number;
  /** kWh siden midnatt */
  accumulatedConsumption: number;
  /** kr siden midnatt */
  accumulatedCost: number | null;
  minPower: number;
  averagePower: number;
  maxPower: number;
  currency: string | null;
}

const LIVE_FIELDS = 'timestamp power accumulatedConsumption accumulatedCost minPower averagePower maxPower currency';
const IDLE_MS = 10 * 60_000; // lukk tilkoblingen når ingen har spurt på 10 min

const live: {
  data: TibberLive | null;
  ws: WebSocket | null;
  lastRequest: number;
  error: string | null;
  retry: ReturnType<typeof setTimeout> | null;
  backoff: number;
  /** Hold tilkoblingen åpen selv om ingen spør (gjenkjenning av apparater) */
  keepAlive: boolean;
} = { data: null, ws: null, lastRequest: 0, error: null, retry: null, backoff: 5_000, keepAlive: false };

const wanted = () => live.keepAlive || Date.now() - live.lastRequest < IDLE_MS;

// Siste målinger (W) for analyse av trinn i forbruket
const HISTORY_MS = 30 * 60_000;
export interface PowerSample {
  /** ms siden epoch */
  t: number;
  w: number;
}
const history: PowerSample[] = [];
const listeners = new Set<(s: PowerSample) => void>();

/** Målinger fra og med `since` (ms), eldste først. */
export const powerHistory = (since = 0) => history.filter((s) => s.t >= since);
export function onPowerSample(fn: (s: PowerSample) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Slå vedvarende tilkobling av/på. Kobler til med en gang når den slås på. */
export function tibberKeepAlive(on: boolean) {
  live.keepAlive = on;
  if (on && tibberConfigured() && !live.ws && !live.retry) void connectLive();
}

async function pulseHome() {
  const d = await gql<{ viewer: { websocketSubscriptionUrl: string; homes: { id: string; features: { realTimeConsumptionEnabled: boolean | null } | null }[] } }>(
    `{ viewer { websocketSubscriptionUrl homes { id features { realTimeConsumptionEnabled } } } }`,
  );
  const home = d.viewer.homes.find((h) => h.features?.realTimeConsumptionEnabled);
  if (!home) throw new TibberError(404, 'Ingen Tibber-hjem med Pulse (sanntidsmåling)');
  return { url: d.viewer.websocketSubscriptionUrl, homeId: home.id };
}

async function connectLive() {
  if (live.ws) return;
  live.retry = null;
  try {
    const { url, homeId } = await pulseHome();
    const ws = new WebSocket(url, { protocols: ['graphql-transport-ws'], headers: { 'user-agent': 'mill-dashboard/0.1' } } as never);
    live.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'connection_init', payload: { token: process.env.TIBBER_TOKEN } }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.type === 'connection_ack') {
        ws.send(JSON.stringify({ id: '1', type: 'subscribe', payload: { query: `subscription { liveMeasurement(homeId: "${homeId}") { ${LIVE_FIELDS} } }` } }));
      } else if (m.type === 'next' && m.payload?.data?.liveMeasurement) {
        live.data = m.payload.data.liveMeasurement;
        live.error = null;
        live.backoff = 5_000;
        const sample = { t: new Date(live.data!.timestamp).getTime(), w: live.data!.power };
        history.push(sample);
        while (history.length && history[0].t < sample.t - HISTORY_MS) history.shift();
        for (const fn of listeners) fn(sample);
        if (!wanted()) ws.close();
      } else if (m.type === 'error' || m.type === 'connection_error') {
        live.error = 'Tibber avviste sanntidsabonnementet';
      }
    };
    ws.onclose = () => {
      live.ws = null;
      // Koble til igjen bare hvis noen fortsatt følger med
      if (wanted()) scheduleReconnect();
    };
    ws.onerror = () => {
      live.error = 'Mistet forbindelsen til Tibber Pulse';
    };
  } catch (err) {
    live.error = err instanceof Error ? err.message : 'Kunne ikke koble til Tibber Pulse';
    live.ws = null;
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (live.retry) return;
  live.retry = setTimeout(connectLive, live.backoff);
  live.backoff = Math.min(live.backoff * 2, 5 * 60_000);
}

/** Siste sanntidsmåling. Starter tilkoblingen ved første kall; venter kort på første verdi. */
export async function tibberLive(): Promise<{ live: TibberLive | null; error: string | null }> {
  if (!tibberConfigured()) throw new TibberError(503, 'TIBBER_TOKEN er ikke satt i .env');
  live.lastRequest = Date.now();
  if (!live.ws && !live.retry) await connectLive();
  for (let i = 0; i < 40 && !live.data && !live.error; i++) await new Promise((r) => setTimeout(r, 250));
  // Eldre enn 2 min = utdatert (Pulse sender vanligvis hvert par sekund)
  const fresh = live.data && Date.now() - new Date(live.data.timestamp).getTime() < 120_000 ? live.data : null;
  return { live: fresh, error: fresh ? null : live.error };
}
