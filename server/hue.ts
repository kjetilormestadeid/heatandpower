// Philips Hue Remote API (via skyen, api.meethue.com) – OAuth2 + CLIP v2.
// Tokens og bro-nøkkel lagres i data/hue.json (ikke sjekket inn).
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchRetry } from './net.ts';

const HUE = 'https://api.meethue.com';
const STORE = path.resolve('data/hue.json');
// Et kall som henger blokkerer alle skjermer (de venter på samme lesing) – gi heller opp og prøv igjen
const TIMEOUT_MS = 20_000;

export class HueError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const hueConfigured = () => Boolean(process.env.HUE_CLIENT_ID && process.env.HUE_CLIENT_SECRET);
const callbackUrl = () => process.env.HUE_CALLBACK_URL ?? 'http://localhost:5173/api/hue/callback';

interface Stored {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** hue-application-key (bro-bruker) */
  appKey: string | null;
}

let stored: Stored | null = null;
let loaded = false;

async function load() {
  if (loaded) return stored;
  loaded = true;
  if (existsSync(STORE)) stored = JSON.parse(await readFile(STORE, 'utf8'));
  return stored;
}

async function save(s: Stored | null) {
  stored = s;
  await mkdir(path.dirname(STORE), { recursive: true });
  await writeFile(STORE, JSON.stringify(s, null, 2));
}

export async function hueConnected() {
  const s = await load();
  return Boolean(s?.refreshToken && s.appKey);
}

// --- OAuth2 -----------------------------------------------------------------

const pendingStates = new Map<string, number>();

/** URL brukeren sendes til for å godkjenne appen hos Philips. */
export function hueAuthorizeUrl() {
  if (!hueConfigured()) throw new HueError(503, 'HUE_CLIENT_ID og HUE_CLIENT_SECRET er ikke satt i .env');
  const state = randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now());
  const q = new URLSearchParams({
    client_id: process.env.HUE_CLIENT_ID!,
    response_type: 'code',
    state,
    redirect_uri: callbackUrl(),
  });
  return `${HUE}/v2/oauth2/authorize?${q}`;
}

async function tokenRequest(params: Record<string, string>) {
  const basic = Buffer.from(`${process.env.HUE_CLIENT_ID}:${process.env.HUE_CLIENT_SECRET}`).toString('base64');
  const res = await fetchRetry(`${HUE}/v2/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => null)) as
    | { access_token: string; refresh_token: string; expires_in: number; error?: string; error_description?: string }
    | null;
  if (!res.ok || !data?.access_token)
    throw new HueError(502, `Hue-innlogging feilet: ${data?.error_description ?? data?.error ?? res.status}`);
  return data;
}

/** Fullfører innloggingen: bytter kode mot token og henter nøkkel til broen. */
export async function hueCallback(code: string, state: string) {
  const at = pendingStates.get(state);
  pendingStates.delete(state);
  if (!at || Date.now() - at > 10 * 60_000) throw new HueError(400, 'Ugyldig eller utløpt Hue-innlogging – prøv igjen');
  const t = await tokenRequest({ grant_type: 'authorization_code', code });
  await save({ accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000, appKey: null });
  await ensureAppKey();
}

// Refresh-token byttes ut ved hver fornyelse: parallelle kall må dele én fornyelse, ellers bruker de samme token flere ganger
let refreshing: Promise<string> | null = null;

async function accessToken() {
  const s = await load();
  if (!s) throw new HueError(409, 'Hue er ikke koblet til ennå');
  if (Date.now() < s.expiresAt - 5 * 60_000) return s.accessToken;
  refreshing ??= (async () => {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken });
    await save({ ...(await load())!, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  })().finally(() => (refreshing = null));
  return refreshing;
}

/** «Trykker» link-knappen via skyen og registrerer en bro-bruker (hue-application-key). */
async function ensureAppKey() {
  const s = await load();
  if (s?.appKey) return s.appKey;
  const token = await accessToken();
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  await fetchRetry(`${HUE}/route/api/0/config`, { method: 'PUT', headers, body: JSON.stringify({ linkbutton: true }) });
  const res = await fetchRetry(`${HUE}/route/api`, { method: 'POST', headers, body: JSON.stringify({ devicetype: 'mill-dashboard#server' }) });
  const body = (await res.json().catch(() => null)) as { success?: { username: string }; error?: { description: string } }[] | null;
  const key = body?.[0]?.success?.username;
  if (!key) throw new HueError(502, `Fikk ikke nøkkel fra Hue-broen: ${body?.[0]?.error?.description ?? res.status}`);
  await save({ ...(await load())!, appKey: key });
  return key;
}

export async function hueDisconnect() {
  readCache.clear();
  await save(null);
}

// --- CLIP v2 ----------------------------------------------------------------

// Hue Remote API går via skyen: cache lesinger kort og del dem mellom alle skjermer, tøm ved endringer
// Lys og gruppestatus endrer seg; rom/soner/hjem nesten aldri (tømmes uansett ved navnebytte, som er en PUT)
const READ_CACHE_MS = 15_000;
const STRUCTURE_CACHE_MS = 10 * 60_000;
const STRUCTURE = new Set(['room', 'zone', 'bridge_home']);
// Rett etter av/på spør appen tett for å se ny status – da caches status bare kort
const AFTER_WRITE_MS = 30_000;
const AFTER_WRITE_CACHE_MS = 1_500;
let lastWrite = 0;
const readCache = new Map<string, { at: number; data: unknown }>();
const readInflight = new Map<string, Promise<unknown>>();

async function clip<T>(method: 'GET' | 'PUT', resource: string, body?: unknown, retried = false): Promise<T> {
  if (method === 'PUT') {
    readCache.clear();
    lastWrite = Date.now();
    return clipRaw<T>(method, resource, body, retried);
  }
  const hit = readCache.get(resource);
  const ttl = STRUCTURE.has(resource) ? STRUCTURE_CACHE_MS : Date.now() - lastWrite < AFTER_WRITE_MS ? AFTER_WRITE_CACHE_MS : READ_CACHE_MS;
  if (hit && Date.now() - hit.at < ttl) return hit.data as T;
  const pending = readInflight.get(resource);
  if (pending) return pending as Promise<T>;
  const p = clipRaw<T>(method, resource, body, retried)
    .then((data) => (readCache.set(resource, { at: Date.now(), data }), data))
    .finally(() => readInflight.delete(resource));
  readInflight.set(resource, p);
  return p;
}

async function clipRaw<T>(method: 'GET' | 'PUT', resource: string, body?: unknown, retried = false): Promise<T> {
  const res = await fetchRetry(`${HUE}/route/clip/v2/resource/${resource}`, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      'hue-application-key': await ensureAppKey(),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 && !retried) {
    // Token kan være trukket tilbake – tving fornyelse én gang
    const s = await load();
    if (s) await save({ ...s, expiresAt: 0 });
    return clipRaw<T>(method, resource, body, true);
  }
  const data = (await res.json().catch(() => null)) as { data?: T; errors?: { description: string }[] } | null;
  if (!res.ok) throw new HueError(res.status === 429 ? 429 : 502, data?.errors?.[0]?.description ?? `Hue ${res.status}`);
  return data?.data as T;
}

interface ClipLight {
  id: string;
  owner: { rid: string };
  metadata: { name: string; archetype?: string };
  on: { on: boolean };
  dimming?: { brightness: number };
}
interface ClipRoom {
  id: string;
  metadata: { name: string };
  children: { rid: string; rtype: string }[];
  services: { rid: string; rtype: string }[];
}
interface ClipGroupedLight {
  id: string;
  on?: { on: boolean };
  dimming?: { brightness: number };
}

export interface HueLight {
  id: string;
  name: string;
  room: string | null;
  on: boolean;
  /** 0–100, null for lamper uten dimming */
  brightness: number | null;
}

let lightsCache: { at: number; data: HueLight[] } | null = null;

export async function hueLights(): Promise<HueLight[]> {
  if (lightsCache && Date.now() - lightsCache.at < 15_000) return lightsCache.data;
  const [lights, rooms] = await Promise.all([clip<ClipLight[]>('GET', 'light'), clip<ClipRoom[]>('GET', 'room')]);
  // Rom peker på enheter (device); lampen eier-peker til samme enhet
  const roomByDevice = new Map<string, string>();
  for (const r of rooms) for (const c of r.children) if (c.rtype === 'device') roomByDevice.set(c.rid, r.metadata.name);
  const data = lights
    .map((l) => ({
      id: l.id,
      name: l.metadata.name,
      room: roomByDevice.get(l.owner.rid) ?? null,
      on: l.on.on,
      brightness: l.dimming ? Math.round(l.dimming.brightness) : null,
    }))
    .sort((a, b) => (a.room ?? '~').localeCompare(b.room ?? '~', 'nb') || a.name.localeCompare(b.name, 'nb'));
  lightsCache = { at: Date.now(), data };
  return data;
}

export async function hueSetLight(id: string, on: boolean) {
  await clip('PUT', `light/${encodeURIComponent(id)}`, { on: { on } });
  lightsCache = null;
  groupsCache = null;
}

export interface HueGroup {
  /** grouped_light-id – brukes for å slå hele gruppen av/på */
  id: string;
  name: string;
  kind: 'home' | 'room' | 'zone';
  /** minst én lampe i gruppen er på */
  on: boolean;
  lights: number;
  /** room-/zone-id for å endre navn (null for hele hjemmet) */
  resourceId: string | null;
  /** snitt-lysstyrke 0–100 for lampene som er på, null om gruppen ikke kan dimmes */
  brightness: number | null;
}

let groupsCache: { at: number; data: HueGroup[] } | null = null;

/** Rom, soner og «hele hjemmet» med samlet av/på-status. */
export async function hueGroups(): Promise<HueGroup[]> {
  if (groupsCache && Date.now() - groupsCache.at < 15_000) return groupsCache.data;
  const [rooms, zones, homes, grouped, lights] = await Promise.all([
    clip<ClipRoom[]>('GET', 'room'),
    clip<ClipRoom[]>('GET', 'zone'),
    clip<ClipRoom[]>('GET', 'bridge_home'),
    clip<ClipGroupedLight[]>('GET', 'grouped_light'),
    clip<ClipLight[]>('GET', 'light'),
  ]);
  const onById = new Map(grouped.map((g) => [g.id, g.on?.on ?? false]));
  const dimById = new Map(grouped.map((g) => [g.id, g.dimming ? Math.round(g.dimming.brightness) : null]));
  const lightsByDevice = new Map<string, number>();
  for (const l of lights) lightsByDevice.set(l.owner.rid, (lightsByDevice.get(l.owner.rid) ?? 0) + 1);
  // Rom har enheter som barn, soner har lamper; hjemmet teller alle lamper
  const count = (g: ClipRoom, kind: HueGroup['kind']) =>
    kind === 'home'
      ? lights.length
      : g.children.reduce((n, c) => n + (c.rtype === 'light' ? 1 : c.rtype === 'device' ? (lightsByDevice.get(c.rid) ?? 0) : 0), 0);
  const toGroups = (list: ClipRoom[], kind: HueGroup['kind']) =>
    list.flatMap((g) => {
      const gl = g.services.find((s) => s.rtype === 'grouped_light');
      const n = count(g, kind);
      return gl && n > 0
        ? [{ id: gl.rid, name: kind === 'home' ? 'Alle lys' : g.metadata.name, kind, on: onById.get(gl.rid) ?? false, lights: n, resourceId: kind === 'home' ? null : g.id, brightness: dimById.get(gl.rid) ?? null }]
        : [];
    });
  const byName = (a: HueGroup, b: HueGroup) => a.name.localeCompare(b.name, 'nb');
  const data = [...toGroups(homes, 'home'), ...toGroups(rooms, 'room').sort(byName), ...toGroups(zones, 'zone').sort(byName)];
  groupsCache = { at: Date.now(), data };
  return data;
}

/** Hue tillater 1–32 tegn i navn. */
function validName(name: string) {
  const n = name.trim();
  if (!n || n.length > 32) throw new HueError(400, 'Navnet må være 1–32 tegn');
  return n;
}

/** Får lampen til å blinke kort så man ser hvilken det er (CLIP v2 identify). */
export async function hueIdentifyLight(id: string) {
  await clip('PUT', `light/${encodeURIComponent(id)}`, { identify: { action: 'identify' } });
}

export async function hueRenameLight(id: string, name: string) {
  await clip('PUT', `light/${encodeURIComponent(id)}`, { metadata: { name: validName(name) } });
  lightsCache = null;
}

export async function hueRenameGroup(kind: 'room' | 'zone', id: string, name: string) {
  await clip('PUT', `${kind}/${encodeURIComponent(id)}`, { metadata: { name: validName(name) } });
  lightsCache = null;
  groupsCache = null;
}

/** Hue godtar 0–100 (0 = laveste nivå, ikke av); vi holder oss på 1–100. */
const clampBrightness = (b: number) => Math.min(100, Math.max(1, Math.round(b)));

export async function hueDimLight(id: string, brightness: number) {
  await clip('PUT', `light/${encodeURIComponent(id)}`, { on: { on: true }, dimming: { brightness: clampBrightness(brightness) } });
  lightsCache = null;
  groupsCache = null;
}

export async function hueDimGroup(id: string, brightness: number) {
  await clip('PUT', `grouped_light/${encodeURIComponent(id)}`, { on: { on: true }, dimming: { brightness: clampBrightness(brightness) } });
  lightsCache = null;
  groupsCache = null;
}

export async function hueSetGroup(id: string, on: boolean) {
  await clip('PUT', `grouped_light/${encodeURIComponent(id)}`, { on: { on } });
  lightsCache = null;
  groupsCache = null;
}
