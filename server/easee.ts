// Easee Cloud API: https://developer.easee.com/
// Innlogging med brukernavn/passord fra .env; token holdes kun her på serveren.
import { fetchRetry } from './net.ts';

const EASEE_URL = 'https://api.easee.com';

export class EaseeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const easeeConfigured = () => Boolean(process.env.EASEE_USERNAME && process.env.EASEE_PASSWORD);

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  /** sekunder */
  expiresIn: number;
}

let token: { access: string; refresh: string; expiresAt: number } | null = null;
let pendingAuth: Promise<string> | null = null;

function saveToken(t: TokenResponse) {
  token = { access: t.accessToken, refresh: t.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 };
  return t.accessToken;
}

async function post<T>(path: string, body: unknown, auth?: string): Promise<T> {
  const res = await fetchRetry(EASEE_URL + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as { title?: string; detail?: string } | null;
  if (!res.ok) throw new EaseeError(res.status, data?.title ?? data?.detail ?? `Easee ${res.status}`);
  return data as T;
}

async function login() {
  if (!easeeConfigured()) throw new EaseeError(503, 'EASEE_USERNAME og EASEE_PASSWORD er ikke satt i .env');
  try {
    return saveToken(
      await post<TokenResponse>('/api/accounts/login', {
        userName: process.env.EASEE_USERNAME,
        password: process.env.EASEE_PASSWORD,
      }),
    );
  } catch (err) {
    if (err instanceof EaseeError && (err.status === 400 || err.status === 401))
      throw new EaseeError(502, 'Easee avviste innloggingen – sjekk brukernavn/passord i .env');
    throw err;
  }
}

/** Gyldig access token: gjenbruk, forny like før utløp, ellers logg inn på nytt. */
async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return token.access;
  pendingAuth ??= (async () => {
    try {
      if (token) {
        try {
          return saveToken(await post<TokenResponse>('/api/accounts/refresh_token', { refreshToken: token.refresh }, token.access));
        } catch {
          token = null;
        }
      }
      return await login();
    } finally {
      pendingAuth = null;
    }
  })();
  return pendingAuth;
}

async function request<T>(method: 'GET' | 'POST', path: string, retried = false): Promise<T> {
  const res = await fetchRetry(EASEE_URL + path, { method, headers: { authorization: `Bearer ${await accessToken()}` } });
  if (res.status === 401 && !retried) {
    token = null;
    return request<T>(method, path, true);
  }
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const msg = res.status === 429 ? 'Easee: for mange forespørsler, prøv igjen om litt' : (data?.title ?? `Easee ${res.status}`);
    throw new EaseeError(res.status, msg);
  }
  return data as T;
}

// Easee har strenge rate-limits (f.eks. /api/chargers maks 2/min) – cache alt som leses.
const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

export interface EaseeCharger {
  id: string;
  name: string | null;
  productCode: number | null;
}

/** Ladestatus satt sammen fra observations-API-et (https://developer.easee.com/docs/charger-observation-ids). */
export interface EaseeState {
  chargerOpMode: number;
  /** kW */
  totalPower: number;
  /** kWh i pågående/siste økt */
  sessionEnergy: number;
  /** A */
  outputCurrent: number | null;
  dynamicChargerCurrent: number | null;
  cableLocked: boolean | null;
  isOnline: boolean;
  latestPulse: string | null;
}

const OBS = {
  opMode: 109,
  totalPower: 120,
  sessionEnergy: 121,
  outputCurrent: 114,
  dynamicCurrent: 48,
  cableLocked: 103,
  online: 250,
} as const;

export function easeeChargers() {
  return cached('chargers', 10 * 60_000, async () =>
    (await request<EaseeCharger[]>('GET', '/api/chargers')).map((c) => ({ id: c.id, name: c.name, productCode: c.productCode })),
  );
}

export function easeeCharger(id: string) {
  const enc = encodeURIComponent(id);
  return cached(`state:${id}`, 20_000, async () => {
    // /api/chargers/{id}/state gir 403 for vanlige kontoer – observations er det dokumenterte alternativet
    const { observations } = await request<{ observations: { id: number; value: unknown }[] }>(
      'GET',
      `/state/${enc}/observations?ids=${Object.values(OBS).join(',')}`,
    );
    const obs = new Map(observations.map((o) => [o.id, o.value]));
    const num = (k: keyof typeof OBS) => (typeof obs.get(OBS[k]) === 'number' ? (obs.get(OBS[k]) as number) : null);
    const bool = (k: keyof typeof OBS) => (typeof obs.get(OBS[k]) === 'boolean' ? (obs.get(OBS[k]) as boolean) : null);
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 86_400_000);
    // Timesforbruk i dag: cache lenger, det endrer seg sakte
    const hourly = await cached(`hourly:${id}:${from.toDateString()}`, 10 * 60_000, () =>
      request<{ from: string; to: string; totalEnergy: number }[]>(
        'GET',
        `/api/chargers/${enc}/usage/hourly/${from.toISOString()}/${to.toISOString()}`,
      ).catch(() => []),
    );
    return {
      state: {
        chargerOpMode: num('opMode') ?? 0,
        totalPower: num('totalPower') ?? 0,
        sessionEnergy: num('sessionEnergy') ?? 0,
        outputCurrent: num('outputCurrent'),
        dynamicChargerCurrent: num('dynamicCurrent'),
        cableLocked: bool('cableLocked'),
        isOnline: bool('online') ?? false,
        latestPulse: null,
      } satisfies EaseeState,
      hourly,
    };
  });
}

const COMMANDS = {
  start: 'start_charging',
  stop: 'stop_charging',
  pause: 'pause_charging',
  resume: 'resume_charging',
} as const;
export type EaseeCommand = keyof typeof COMMANDS;
export const isEaseeCommand = (c: string): c is EaseeCommand => c in COMMANDS;

export async function easeeCommand(id: string, cmd: EaseeCommand) {
  await request('POST', `/api/chargers/${encodeURIComponent(id)}/commands/${COMMANDS[cmd]}`);
  cache.delete(`state:${id}`); // neste lesing henter fersk status
}
