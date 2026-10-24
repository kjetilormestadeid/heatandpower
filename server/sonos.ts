// Sonos Control API (offisielt, via skyen): https://docs.sonos.com/docs/control
// OAuth2 med Basic-auth mot token-endepunktet. Sonos krever en offentlig HTTPS redirect-URL,
// så innloggingen kan fullføres enten via /api/sonos/callback (hvis redirect lander her)
// eller ved å lime inn adressen man havnet på (/api/sonos/complete).
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const AUTH = 'https://api.sonos.com/login/v3/oauth';
const CONTROL = 'https://api.ws.sonos.com/control/api/v1';
const STORE = path.resolve('data/sonos.json');

export class SonosError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const sonosConfigured = () => Boolean(process.env.SONOS_CLIENT_ID && process.env.SONOS_CLIENT_SECRET && process.env.SONOS_REDIRECT_URI);

interface Stored {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
let stored: Stored | null = null;
let loaded = false;

async function load() {
  if (!loaded) {
    loaded = true;
    if (existsSync(STORE)) stored = JSON.parse(await readFile(STORE, 'utf8'));
  }
  return stored;
}
async function save(s: Stored | null) {
  stored = s;
  await mkdir(path.dirname(STORE), { recursive: true });
  await writeFile(STORE, JSON.stringify(s, null, 2));
}

export const sonosConnected = async () => Boolean((await load())?.refreshToken);
export const sonosDisconnect = () => {
  householdId = null;
  cache = null;
  return save(null);
};

// --- OAuth ------------------------------------------------------------------

const pendingStates = new Map<string, number>();

export function sonosAuthorizeUrl() {
  if (!sonosConfigured()) throw new SonosError(503, 'SONOS_CLIENT_ID, SONOS_CLIENT_SECRET og SONOS_REDIRECT_URI må settes i .env');
  const state = randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now());
  const q = new URLSearchParams({
    client_id: process.env.SONOS_CLIENT_ID!,
    response_type: 'code',
    state,
    scope: 'playback-control-all',
    redirect_uri: process.env.SONOS_REDIRECT_URI!,
  });
  return `${AUTH}?${q}`;
}

async function token(params: Record<string, string>) {
  const basic = Buffer.from(`${process.env.SONOS_CLIENT_ID}:${process.env.SONOS_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${AUTH}/access`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params),
  });
  const data = (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string } | null;
  if (!res.ok || !data?.access_token) throw new SonosError(502, `Sonos-innlogging feilet: ${data?.error_description ?? data?.error ?? res.status}`);
  return data as { access_token: string; refresh_token?: string; expires_in: number };
}

/** Fullfør innloggingen med koden fra redirect (direkte callback eller limt-inn adresse). */
export async function sonosComplete(code: string, state: string) {
  const at = pendingStates.get(state);
  pendingStates.delete(state);
  if (!at || Date.now() - at > 15 * 60_000) throw new SonosError(400, 'Ugyldig eller utløpt Sonos-innlogging – trykk «Koble til Sonos» igjen');
  const t = await token({ grant_type: 'authorization_code', code, redirect_uri: process.env.SONOS_REDIRECT_URI! });
  await save({ accessToken: t.access_token, refreshToken: t.refresh_token ?? '', expiresAt: Date.now() + t.expires_in * 1000 });
}

/** Ta ut code/state fra adressen brukeren havnet på – eller bare koden alene. */
export function parseRedirect(input: string) {
  const text = input.trim();
  let params: URLSearchParams | null = null;
  try {
    params = new URL(text).searchParams;
  } catch {
    // ikke en hel URL – kan være «code=…&state=…» eller bare koden
    if (text.includes('=')) params = new URLSearchParams(text.replace(/^[?#]/, ''));
  }
  if (params?.get('error')) {
    throw new SonosError(400, `Sonos returnerte en feil: ${params.get('error_description') ?? params.get('error')}`);
  }
  const code = params ? params.get('code') : /^[\w.-]{8,}$/.test(text) ? text : null;
  if (!code) {
    throw new SonosError(
      400,
      'Fant ingen kode i adressen. Sjekk at adressefeltet inneholder «?code=…» rett etter at du godkjente – sender redirect-siden deg videre, kan koden forsvinne.',
    );
  }
  // Uten state (bare koden limt inn): bruk siste påbegynte innlogging
  const state = params?.get('state') ?? [...pendingStates.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
  return { code, state };
}

async function accessToken() {
  const s = await load();
  if (!s) throw new SonosError(409, 'Sonos er ikke koblet til ennå');
  if (Date.now() < s.expiresAt - 5 * 60_000) return s.accessToken;
  const t = await token({ grant_type: 'refresh_token', refresh_token: s.refreshToken });
  await save({ accessToken: t.access_token, refreshToken: t.refresh_token ?? s.refreshToken, expiresAt: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

// --- Control API -------------------------------------------------------------

// Sonos tillater 20 000 kall per døgn per bruker. Brukes kvoten opp, venter vi en stund før vi spør igjen.
let blockedUntil = 0;

async function api<T>(method: 'GET' | 'POST', p: string, body?: unknown, retried = false): Promise<T> {
  if (Date.now() < blockedUntil) throw new SonosError(429, 'Sonos-kvoten (20 000 kall/døgn) er brukt opp – prøver igjen om litt');
  const res = await fetch(CONTROL + p, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) {
    const s = await load();
    if (s) await save({ ...s, expiresAt: 0 });
    return api<T>(method, p, body, true);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 429) blockedUntil = Date.now() + 15 * 60_000;
  if (!res.ok) throw new SonosError(res.status === 429 ? 429 : 502, data?.reason ?? data?.errorCode ?? `Sonos ${res.status}`);
  return data as T;
}

export interface SonosGroup {
  id: string;
  name: string;
  /** romnavn i gruppen */
  players: string[];
  playerIds: string[];
  state: 'playing' | 'paused' | 'idle' | 'buffering';
  track: { title: string | null; artist: string | null; source: string | null; image: string | null } | null;
  volume: number | null;
  muted: boolean;
}
export interface SonosOverview {
  householdId: string;
  groups: SonosGroup[];
  favorites: { id: string; name: string; image: string | null }[];
}

const STATE: Record<string, SonosGroup['state']> = {
  PLAYBACK_STATE_PLAYING: 'playing',
  PLAYBACK_STATE_PAUSED: 'paused',
  PLAYBACK_STATE_IDLE: 'idle',
  PLAYBACK_STATE_BUFFERING: 'buffering',
};

// Kallbudsjett: oversikten koster 1 + ett kall per gruppe (+ metadata for de som ikke er stille),
// så den holdes i 90 s uansett hvor mange skjermer som spør. Rett etter en kommando hentes det
// tettere en kort stund, så ny status kommer fort.
const OVERVIEW_TTL = 90_000;
const BURST_TTL = 3_000;
let cache: { at: number; data: SonosOverview } | null = null;
let inflight: Promise<SonosOverview> | null = null;
let burstUntil = 0;
let householdId: string | null = null;
let favCache: { at: number; householdId: string; items: SonosOverview['favorites'] } | null = null;
/** Volum endres sjelden utenfra – hentes på nytt hvert 10. minutt, eller med en gang vi selv endrer det */
const volCache = new Map<string, { at: number; volume: number; muted: boolean }>();

function changed() {
  cache = null;
  burstUntil = Date.now() + 30_000;
}

export function sonosOverview(): Promise<SonosOverview> {
  const ttl = Date.now() < burstUntil ? BURST_TTL : OVERVIEW_TTL;
  if (cache && Date.now() - cache.at < ttl) return Promise.resolve(cache.data);
  inflight ??= fetchOverview().finally(() => (inflight = null));
  return inflight;
}

async function fetchOverview(): Promise<SonosOverview> {
  if (!householdId) {
    const { households } = await api<{ households: { id: string }[] }>('GET', '/households');
    householdId = households[0]?.id ?? null;
  }
  const hh = householdId;
  if (!hh) throw new SonosError(404, 'Fant ingen Sonos-husstand på kontoen');
  const g = await api<{ groups: { id: string; name: string; playerIds: string[] }[]; players: { id: string; name: string }[] }>('GET', `/households/${hh}/groups`);
  const playerName = new Map(g.players.map((p) => [p.id, p.name]));

  const groups = await Promise.all(
    g.groups.map(async (gr): Promise<SonosGroup> => {
      const pb = await api<{ playbackState: string }>('GET', `/groups/${gr.id}/playback`).catch(() => null);
      const idle = (pb?.playbackState ?? 'PLAYBACK_STATE_IDLE') === 'PLAYBACK_STATE_IDLE';
      const cachedVol = volCache.get(gr.id);
      const [meta, vol] = await Promise.all([
        idle
          ? null
          : api<{ container?: { name?: string }; currentItem?: { track?: { name?: string; artist?: { name?: string }; imageUrl?: string } } }>('GET', `/groups/${gr.id}/playbackMetadata`).catch(() => null),
        cachedVol && Date.now() - cachedVol.at < 10 * 60_000
          ? cachedVol
          : api<{ volume: number; muted: boolean }>('GET', `/groups/${gr.id}/groupVolume`).then(
              (v) => (volCache.set(gr.id, { at: Date.now(), ...v }), v),
              () => null,
            ),
      ]);
      const t = meta?.currentItem?.track;
      return {
        id: gr.id,
        name: gr.name,
        players: gr.playerIds.map((id) => playerName.get(id) ?? id),
        playerIds: gr.playerIds,
        state: STATE[pb?.playbackState ?? ''] ?? 'idle',
        track: t?.name || meta?.container?.name ? { title: t?.name ?? null, artist: t?.artist?.name ?? null, source: meta?.container?.name ?? null, image: t?.imageUrl ?? null } : null,
        volume: vol?.volume ?? null,
        muted: vol?.muted ?? false,
      };
    }),
  );

  if (!favCache || favCache.householdId !== hh || Date.now() - favCache.at > 10 * 60_000) {
    const f = await api<{ items: { id: string; name: string; imageUrl?: string }[] }>('GET', `/households/${hh}/favorites`).catch(() => ({ items: [] }));
    favCache = { at: Date.now(), householdId: hh, items: f.items.map((x) => ({ id: x.id, name: x.name, image: x.imageUrl ?? null })) };
  }

  const data = { householdId: hh, groups: groups.sort((a, b) => a.name.localeCompare(b.name, 'nb')), favorites: favCache.items };
  cache = { at: Date.now(), data };
  return data;
}

const COMMANDS = { play: 'play', pause: 'pause', toggle: 'togglePlayPause', next: 'skipToNextTrack', previous: 'skipToPreviousTrack' } as const;
export type SonosCommand = keyof typeof COMMANDS;
export const isSonosCommand = (c: string): c is SonosCommand => c in COMMANDS;

export async function sonosCommand(groupId: string, cmd: SonosCommand) {
  await api('POST', `/groups/${encodeURIComponent(groupId)}/playback/${COMMANDS[cmd]}`);
  changed();
}

export async function sonosVolume(groupId: string, volume: number) {
  const v = Math.min(100, Math.max(0, Math.round(volume)));
  await api('POST', `/groups/${encodeURIComponent(groupId)}/groupVolume`, { volume: v });
  volCache.set(groupId, { at: Date.now(), volume: v, muted: false });
  changed();
}

export async function sonosFavorite(groupId: string, favoriteId: string) {
  await api('POST', `/groups/${encodeURIComponent(groupId)}/favorites`, { favoriteId, playOnCompletion: true, action: 'REPLACE' });
  changed();
}

/** Spill en favoritt på én høyttaler alene: er den gruppert med andre, tas den ut i en egen gruppe først. */
export async function sonosPlayerFavorite(playerId: string, favoriteId: string) {
  const o = await sonosOverview();
  const group = o.groups.find((g) => g.playerIds.includes(playerId));
  if (!group) throw new SonosError(404, 'Fant ikke høyttaleren');
  let groupId = group.id;
  if (group.playerIds.length > 1) {
    const r = await api<{ group: { id: string } }>('POST', `/households/${o.householdId}/groups/createGroup`, { playerIds: [playerId] });
    groupId = r.group.id;
  }
  await sonosFavorite(groupId, favoriteId);
}

/** Pause alle grupper som spiller. */
export async function sonosPauseAll() {
  const o = await sonosOverview();
  await Promise.all(o.groups.filter((g) => g.state === 'playing' || g.state === 'buffering').map((g) => api('POST', `/groups/${g.id}/playback/pause`).catch(() => null)));
  changed();
}
