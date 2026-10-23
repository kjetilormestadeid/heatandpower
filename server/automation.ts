// Fuktstyring av en Mill-stikkontakt (f.eks. avfukter): på over en grense, av under en annen,
// men bare innenfor et tidsrom på dagtid – utenfor tidsrommet holdes den av (den bråker om natta).
// Kjører i backend hvert 5. minutt med økten til brukeren som satte opp regelen.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hasSession, millRequest } from './mill.ts';

const FILE = path.resolve('data/automations.json');
const INTERVAL_MS = 5 * 60_000;

export interface HumidityRule {
  deviceId: string;
  houseId: string;
  name: string;
  enabled: boolean;
  /** "HH:MM" – tidsrommet styringen får slå på enheten */
  from: string;
  to: string;
  /** slå på ved fuktighet ≥ denne (%) */
  onAbove: number;
  /** slå av ved fuktighet ≤ denne (%) */
  offBelow: number;
  /** økten som brukes mot Mill (brukeren som lagret regelen) */
  sid: string;
  last?: { at: string; humidity: number | null; isOn: boolean | null; action: 'on' | 'off' | 'none'; reason: string; error?: string };
}

let rules: HumidityRule[] | null = null;

async function load() {
  if (!rules) rules = existsSync(FILE) ? (JSON.parse(await readFile(FILE, 'utf8')).humidity ?? []) : [];
  return rules!;
}
async function save() {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify({ humidity: rules }, null, 2));
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};
/** Er klokka innenfor [from, to)? Støtter tidsrom over midnatt. */
export function inWindow(from: string, to: string, d = new Date()) {
  const now = d.getHours() * 60 + d.getMinutes();
  const a = toMin(from);
  const b = toMin(to);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

/** Ønsket tilstand: null = behold (mellom grensene). */
export function decide(r: Pick<HumidityRule, 'from' | 'to' | 'onAbove' | 'offBelow'>, humidity: number | null, d = new Date()) {
  if (!inWindow(r.from, r.to, d)) return { want: false as boolean | null, reason: `utenfor ${r.from}–${r.to}` };
  if (humidity == null) return { want: null, reason: 'ingen fuktmåling' };
  if (humidity >= r.onAbove) return { want: true, reason: `${Math.round(humidity)} % ≥ ${r.onAbove} %` };
  if (humidity <= r.offBelow) return { want: false, reason: `${Math.round(humidity)} % ≤ ${r.offBelow} %` };
  return { want: null, reason: `${Math.round(humidity)} % mellom grensene` };
}

/** Mill-kall som kaster ved HTTP-feil (millRequest returnerer bare status). */
async function mill<T>(sid: string, method: string, urlPath: string, body?: unknown): Promise<T> {
  const res = await millRequest(sid, method, urlPath, body);
  if (res.status >= 400) throw new Error(`Mill svarte ${res.status} på ${method} ${urlPath.split("?")[0]}`);
  return res.data as T;
}

interface Dev {
  deviceId: string;
  isEnabled: boolean | null;
  isConnected: boolean;
  lastMetrics: { humidity?: number } | null;
}

async function findDevice(r: HumidityRule): Promise<Dev | undefined> {
  const ind = await mill<{ items: Dev[] }>(r.sid, 'GET', `/houses/${r.houseId}/devices/independent?filterDevices=allDevice`);
  const hit = ind.items.find((d) => d.deviceId === r.deviceId);
  if (hit) return hit;
  const { rooms } = await mill<{ rooms: { id: string }[] }>(r.sid, 'GET', `/houses/${r.houseId}/rooms`);
  for (const room of rooms) {
    const { devices } = await mill<{ devices: Dev[] }>(r.sid, 'GET', `/rooms/${room.id}/devices`);
    const d = devices.find((x) => x.deviceId === r.deviceId);
    if (d) return d;
  }
}

async function runRule(r: HumidityRule) {
  const at = new Date().toISOString();
  try {
    if (!hasSession(r.sid)) throw new Error('Økten er utløpt – lagre regelen på nytt mens du er innlogget');
    const d = await findDevice(r);
    if (!d) throw new Error('Fant ikke enheten');
    const humidity = d.lastMetrics?.humidity && d.lastMetrics.humidity > 0 ? d.lastMetrics.humidity : null;
    const { want, reason } = decide(r, humidity);
    let action: 'on' | 'off' | 'none' = 'none';
    if (want != null && d.isConnected && d.isEnabled !== want) {
      await mill(r.sid, 'PATCH', `/devices/${r.deviceId}/enabled`, { isEnabled: want });
      action = want ? 'on' : 'off';
      console.log(`[fuktstyring] ${r.name}: slo ${want ? 'på' : 'av'} (${reason})`);
    }
    r.last = { at, humidity, isOn: action === 'none' ? d.isEnabled : want, action, reason };
  } catch (err) {
    r.last = { at, humidity: r.last?.humidity ?? null, isOn: r.last?.isOn ?? null, action: 'none', reason: 'feil', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runAutomations() {
  for (const r of await load()) if (r.enabled) await runRule(r);
  await save();
}

export async function humidityRules() {
  return (await load()).map(({ sid: _sid, ...r }) => r);
}

export async function saveHumidityRule(sid: string, input: Omit<HumidityRule, 'sid' | 'last'>) {
  const valid = /^\d{1,2}:\d{2}$/;
  if (!valid.test(input.from) || !valid.test(input.to)) throw new Error('Tidsrom må være HH:MM');
  if (!(input.offBelow < input.onAbove)) throw new Error('«Av under» må være lavere enn «på over»');
  const list = await load();
  const i = list.findIndex((r) => r.deviceId === input.deviceId);
  const rule: HumidityRule = { ...(i >= 0 ? list[i] : {}), ...input, sid };
  if (i >= 0) list[i] = rule;
  else list.push(rule);
  if (rule.enabled) await runRule(rule); // vurder med en gang så endringen merkes
  await save();
  return (await humidityRules()).find((r) => r.deviceId === input.deviceId)!;
}

export function startAutomations() {
  setTimeout(() => runAutomations().catch((e) => console.error('[fuktstyring]', e)), 10_000);
  setInterval(() => runAutomations().catch((e) => console.error('[fuktstyring]', e)), INTERVAL_MS);
}
