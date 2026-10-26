import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MILL_API_BASE = process.env.MILL_API_BASE ?? 'https://api.millnorwaycloud.com';
const SESSION_FILE = path.resolve('data', 'sessions.json');
// Mill tillater 2500 kall/time per konto. Leseresultater deles mellom alle skjermer/økter på samme konto.
const READ_CACHE_MS = 50_000; // litt under appens 60 s-intervall, så alle skjermer deler samme henting
// Rett etter en endring spør appen tett for å se ny status – da caches lesinger bare kort
const AFTER_WRITE_MS = 30_000;
const AFTER_WRITE_CACHE_MS = 1_500;

export class MillError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Mill API ${status}`);
  }
}

interface Tokens {
  idToken: string;
  refreshToken: string;
}

interface Session extends Tokens {
  login: string;
  createdAt: number;
}

interface RuntimeState {
  refreshing?: Promise<void>;
}

type MillResponse = { status: number; data: unknown };

interface AccountCache {
  hits: Map<string, { at: number } & MillResponse>;
  /** Kall som pågår – like kall samtidig (flere rom, flere skjermer) venter på samme svar */
  inflight: Map<string, Promise<MillResponse>>;
  lastWrite: number;
}

const sessions = new Map<string, Session>();
const runtime = new Map<string, RuntimeState>();
const accounts = new Map<string, AccountCache>();

function state(sid: string): RuntimeState {
  let s = runtime.get(sid);
  if (!s) {
    s = {};
    runtime.set(sid, s);
  }
  return s;
}

function accountCache(sid: string): AccountCache {
  const key = sessions.get(sid)?.login.trim().toLowerCase() ?? sid;
  let c = accounts.get(key);
  if (!c) {
    c = { hits: new Map(), inflight: new Map(), lastWrite: 0 };
    accounts.set(key, c);
  }
  return c;
}

/** Statistikk hentes med POST, men er en ren lesing og kan caches som GET. */
const isRead = (method: string, urlPath: string) => method === 'GET' || (method === 'POST' && urlPath.endsWith('/statistics'));

// --- persistens: refresh-tokens er engangs og må overleve omstart ---

let saveQueued = false;
function persist() {
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(async () => {
    saveQueued = false;
    await mkdir(path.dirname(SESSION_FILE), { recursive: true });
    await writeFile(SESSION_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2));
  }, 200);
}

export async function loadSessions() {
  try {
    const raw = JSON.parse(await readFile(SESSION_FILE, 'utf8')) as Record<string, Session>;
    for (const [sid, s] of Object.entries(raw)) sessions.set(sid, s);
    console.log(`Lastet ${sessions.size} sesjon(er)`);
  } catch {
    // ingen lagrede sesjoner
  }
}

// --- lavnivå HTTP mot Mill ---

async function call(method: string, urlPath: string, token: string | undefined, body?: unknown) {
  const res = await fetch(MILL_API_BASE + urlPath, {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // Et kall som henger blokkerer alle skjermer (de venter på samme lesing) – gi heller opp og prøv igjen
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: { type: 'InvalidJson', message: text.slice(0, 500) } };
    }
  }
  return { status: res.status, data };
}

function tokenExpiresAt(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

// --- auth ---

export async function signIn(login: string, password: string) {
  const { status, data } = await call('POST', '/customer/auth/sign-in', undefined, { login, password });
  if (status !== 200) throw new MillError(status, data);
  const tokens = data as Tokens;
  const sid = randomBytes(32).toString('base64url');
  sessions.set(sid, { ...tokens, login, createdAt: Date.now() });
  persist();
  return sid;
}

export async function signOut(sid: string) {
  const s = sessions.get(sid);
  if (s) {
    await call('DELETE', '/customer/auth/sign-out', s.idToken).catch(() => {});
  }
  sessions.delete(sid);
  runtime.delete(sid);
  persist();
}

export function getSession(sid: string | undefined) {
  return sid ? sessions.get(sid) : undefined;
}

/** Refresh-token kan bare brukes én gang, og Mill låser det i 3 sek – så vi deduper per sesjon. */
async function refresh(sid: string) {
  const st = state(sid);
  if (!st.refreshing) {
    st.refreshing = (async () => {
      const s = sessions.get(sid);
      if (!s?.refreshToken) throw new MillError(401, { error: { type: 'NoRefreshToken', message: 'Logg inn på nytt' } });
      const { status, data } = await call('POST', '/customer/auth/refresh', s.refreshToken);
      if (status !== 200) {
        // Bare et avvist token betyr at økten er borte – forbigående feil hos Mill (5xx/429) skal ikke logge ut
        if (status >= 500 || status === 429) throw new MillError(502, data);
        sessions.delete(sid);
        persist();
        throw new MillError(401, data);
      }
      const t = data as Tokens;
      sessions.set(sid, { ...s, idToken: t.idToken, refreshToken: t.refreshToken || s.refreshToken });
      persist();
    })().finally(() => {
      st.refreshing = undefined;
    });
  }
  return st.refreshing;
}

async function validToken(sid: string) {
  const s = sessions.get(sid);
  if (!s) throw new MillError(401, { error: { type: 'NoSession', message: 'Ikke innlogget' } });
  if (tokenExpiresAt(s.idToken) - Date.now() < 30_000) await refresh(sid);
  return sessions.get(sid)!.idToken;
}

/** Autentisert kall mot Mill med auto-refresh, felles lese-cache per konto og én retry ved 429. */
export async function millRequest(sid: string, method: string, urlPath: string, body?: unknown): Promise<MillResponse> {
  const cache = accountCache(sid);
  const read = isRead(method, urlPath);

  if (!read) {
    // Endringer: tøm cachen så neste lesing viser det nye
    cache.hits.clear();
    cache.lastWrite = Date.now();
    return send(sid, method, urlPath, body, false);
  }

  const key = `${method} ${urlPath} ${body !== undefined ? JSON.stringify(body) : ''}`;
  const hit = cache.hits.get(key);
  const ttl = Date.now() - cache.lastWrite < AFTER_WRITE_MS ? AFTER_WRITE_CACHE_MS : READ_CACHE_MS;
  if (hit && Date.now() - hit.at < ttl) return { status: hit.status, data: hit.data };
  const pending = cache.inflight.get(key);
  if (pending) return pending;

  const p = send(sid, method, urlPath, body, true)
    .then((res) => {
      if (res.status === 200) cache.hits.set(key, { at: Date.now(), ...res });
      return res;
    })
    .finally(() => cache.inflight.delete(key));
  cache.inflight.set(key, p);
  return p;
}

async function send(sid: string, method: string, urlPath: string, body: unknown, read: boolean): Promise<MillResponse> {
  let res = await call(method, urlPath, await validToken(sid), body);
  if (res.status === 401) {
    await refresh(sid);
    res = await call(method, urlPath, sessions.get(sid)!.idToken, body);
  }
  if (res.status === 429 && read) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await call(method, urlPath, sessions.get(sid)!.idToken, body);
  }
  return res;
}

/** For bakgrunnsjobber (automasjoner): er økten fortsatt gyldig? */
export const hasSession = (sid: string) => sessions.has(sid);
