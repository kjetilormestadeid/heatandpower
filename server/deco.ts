// TP-Link Deco: lokalt admin-API (samme som Deco sin web-UI). Ikke offisielt dokumentert –
// protokollen er portert fra https://github.com/amosyuen/ha-tplink-deco (api.py).
// Innlogging: RSA-kryptert passord + AES-CBC-kryptert payload med RSA-signatur.
import { createCipheriv, createDecipheriv, createHash, createPublicKey, publicEncrypt, randomInt, constants } from 'node:crypto';
import { existsSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class DecoError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const decoConfigured = () => Boolean(process.env.DECO_PASSWORD);
const host = () => (process.env.DECO_HOST ?? '192.168.68.1').replace(/\/$/, '');
// Innlogging over http henger på denne fastvaren – bruk https (Deco har selvsignert sertifikat)
const base = () => (/^https?:\/\//.test(host()) ? host() : `https://${host()}`);
const username = () => process.env.DECO_USERNAME ?? 'admin';

// --- krypto ---------------------------------------------------------------

const b64url = (hex: string) => Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex').toString('base64url');

/** RSA PKCS#1 v1.5 i blokker (TP-Link deler klarteksten opp og setter sammen hex-chiffrene). */
function rsaEncrypt(nHex: string, eHex: string, plain: Buffer) {
  const key = createPublicKey({ key: { kty: 'RSA', n: b64url(nHex), e: b64url(eHex) }, format: 'jwk' });
  const modulusBytes = Buffer.from(nHex.replace(/^0+/, ''), 'hex').length;
  const perBlock = modulusBytes - 11;
  let out = '';
  for (let i = 0; i < plain.length; i += perBlock) {
    out += publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, plain.subarray(i, i + perBlock)).toString('hex');
  }
  return out;
}

// TP-Link krever 16-sifret nøkkel og IV (uten ledende null), brukt som ASCII-bytes
const digits16 = () => String(randomInt(1, 10)) + Array.from({ length: 15 }, () => randomInt(0, 10)).join('');

interface Session {
  aesKey: string;
  aesIv: string;
  pwKey: [string, string];
  signKey: [string, string];
  seq: number;
  stok: string;
  cookie: string;
}

let session: Session | null = null;
let pendingLogin: Promise<Session> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function aesEncrypt(s: Session, text: string) {
  const c = createCipheriv('aes-128-cbc', Buffer.from(s.aesKey), Buffer.from(s.aesIv));
  return Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('base64');
}

function aesDecrypt(s: Pick<Session, 'aesKey' | 'aesIv'>, b64: string) {
  const d = createDecipheriv('aes-128-cbc', Buffer.from(s.aesKey), Buffer.from(s.aesIv));
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
}

function encodePayload(s: Pick<Session, 'aesKey' | 'aesIv' | 'signKey' | 'seq'>, payload: unknown) {
  const data = aesEncrypt(s as Session, JSON.stringify(payload));
  const hash = createHash('md5').update(`${username()}${process.env.DECO_PASSWORD}`).digest('hex');
  const signText = `k=${s.aesKey}&i=${s.aesIv}&h=${hash}&s=${s.seq + data.length}`;
  const sign = rsaEncrypt(s.signKey[0], s.signKey[1], Buffer.from(signText));
  return `sign=${sign}&data=${encodeURIComponent(data)}`;
}

// --- HTTP -------------------------------------------------------------------

async function post(urlPath: string, body: string, cookie?: string, attempt = 1): Promise<{ json: { data?: string; result?: unknown; error_code?: number | string }; setCookie: string | undefined }> {
  let res: { status: number; setCookie: string[]; text: string };
  try {
    // Innlogging tar opptil ~15 s på Deco
    res = await rawPost(`${base()}/cgi-bin/luci/${urlPath}`, body, cookie, 30_000);
  } catch (err) {
    // Aldri send innloggingen på nytt automatisk – et ekstra forsøk kan telle mot Deco sin låsegrense
    const isLogin = urlPath.includes('form=login');
    if (!isLogin && attempt < 2 && err instanceof Error && err.message === 'timeout') return post(urlPath, body, cookie, attempt + 1);
    throw new DecoError(504, `Fikk ikke kontakt med Deco på ${host()} – backend må kjøre på hjemmenettet`);
  }
  if (res.status === 401 || res.status === 403) {
    session = null;
    throw new DecoError(502, 'Deco avviste økten (logget admin inn et annet sted?) – prøv igjen');
  }
  const setCookie = res.setCookie.join(';').match(/sysauth=[a-f0-9]+/)?.[0];
  let json: { data?: string; result?: unknown; error_code?: number | string } | null = null;
  try {
    json = JSON.parse(res.text);
  } catch {
    // ikke JSON – håndteres under
  }
  if (!json) throw new DecoError(502, `Uventet svar fra Deco (${res.status})`);
  return { json, setCookie };
}

/** POST via node:https så Deco sitt selvsignerte sertifikat godtas for akkurat dette kallet (ikke globalt). */
function rawPost(url: string, body: string, cookie: string | undefined, timeoutMs: number) {
  return new Promise<{ status: number; setCookie: string[]; text: string }>((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'POST',
        rejectUnauthorized: false,
        timeout: timeoutMs,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...(cookie ? { cookie } : {}) },
      },
      (r) => {
        let text = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => (text += c));
        r.on('end', () => resolve({ status: r.statusCode ?? 0, setCookie: r.headers['set-cookie'] ?? [], text }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

async function login(): Promise<Session> {
  if (!decoConfigured()) throw new DecoError(503, 'DECO_PASSWORD er ikke satt i .env');
  const keys = await post(';stok=/login?form=keys', JSON.stringify({ operation: 'read' }));
  const auth = await post(';stok=/login?form=auth', JSON.stringify({ operation: 'read' }));
  const pw = (keys.json.result as { password: [string, string] }).password;
  const a = auth.json.result as { key: [string, string]; seq: number };
  const draft = { aesKey: digits16(), aesIv: digits16(), pwKey: pw, signKey: a.key, seq: a.seq };

  const password = rsaEncrypt(pw[0], pw[1], Buffer.from(process.env.DECO_PASSWORD!));
  const res = await post(';stok=/login?form=login', encodePayload(draft, { params: { password }, operation: 'login' }));
  const data = JSON.parse(aesDecrypt(draft, res.json.data ?? '')) as { error_code: number; result?: { stok?: string; attemptsAllowed?: number } };
  if (data.error_code === -5002)
    throw new DecoError(401, `Feil Deco-passord (${data.result?.attemptsAllowed ?? '?'} forsøk igjen før Deco låser innloggingen)`);
  if (data.error_code !== 0 || !data.result?.stok) throw new DecoError(502, `Deco-innlogging feilet (kode ${data.error_code})`);
  if (!res.setCookie) throw new DecoError(502, 'Deco ga ingen sesjons-cookie');
  return { ...draft, stok: data.result.stok, cookie: res.setCookie };
}

async function ensureSession() {
  if (session) return session;
  pendingLogin ??= login().finally(() => (pendingLogin = null));
  session = await pendingLogin;
  return session;
}

/** Kryptert kall mot admin-API-et; logger inn på nytt én gang hvis økten er utløpt. Serialisert – Deco liker ikke parallelle kall. */
function call<T>(form: string, payload: unknown): Promise<T> {
  const run = async (retried: boolean): Promise<T> => {
    const s = await ensureSession();
    try {
      const res = await post(`;stok=${s.stok}/${form}`, encodePayload(s, payload), s.cookie);
      if (!res.json.data) throw new DecoError(502, 'Tomt svar fra Deco');
      const data = JSON.parse(aesDecrypt(s, res.json.data)) as { error_code?: number | string; result?: T };
      if (data.error_code && data.error_code !== 0) throw new DecoError(502, `Deco-feil ${data.error_code}`);
      return data.result as T;
    } catch (err) {
      // Feil passord skal aldri prøves på nytt automatisk – Deco låser innloggingen etter noen forsøk
      if (err instanceof DecoError && err.status === 401) throw err;
      if (!retried) {
        session = null;
        return run(true);
      }
      throw err;
    }
  };
  const p = queue.then(() => run(false));
  queue = p.catch(() => {});
  return p;
}

// --- data -------------------------------------------------------------------

const decodeName = (n: string) => {
  try {
    const s = Buffer.from(n, 'base64').toString('utf8');
    return /^[\p{L}\p{N}\p{P}\p{Zs}\p{S}]+$/u.test(s) && Buffer.from(s).toString('base64') === n ? s : n;
  } catch {
    return n;
  }
};

interface RawClient {
  mac: string;
  name: string;
  ip?: string;
  online?: boolean;
  client_type?: string;
  wire_type?: string;
  connection_type?: string;
  interface?: string;
  access_host?: string;
  down_speed?: number;
  up_speed?: number;
}
interface RawDeco {
  mac: string;
  nickname?: string;
  custom_nickname?: string;
  role?: string;
  inet_status?: string;
  device_model?: string;
  software_ver?: string;
  hardware_ver?: string;
}

export interface DecoClient {
  mac: string;
  name: string;
  ip: string | null;
  /** phone, pc, tablet, iot_device, … (Deco sin gjetning) */
  type: string | null;
  wired: boolean;
  /** hvilken Deco-enhet klienten er koblet til */
  deco: string | null;
  /** kB/s */
  down: number;
  up: number;
  guest: boolean;
  /** '2.4' | '5' | '6' | null (kablet/ukjent) */
  band: string | null;
}

export interface Person {
  name: string;
  macs: string[];
  home: boolean;
  /** ISO – sist en av enhetene var på nettet */
  lastSeen: string | null;
}

const PEOPLE_FILE = path.resolve('data/deco-people.json');
const HOME_GRACE_MS = 15 * 60_000; // telefoner slipper wifi i dvale – regnes som hjemme i 15 min etter sist sett

interface PeopleStore {
  /** mac -> personnavn */
  owners: Record<string, string>;
  /** mac -> ISO sist sett */
  lastSeen: Record<string, string>;
}
let store: PeopleStore | null = null;

async function loadStore() {
  if (store) return store;
  store = existsSync(PEOPLE_FILE) ? JSON.parse(await readFile(PEOPLE_FILE, 'utf8')) : { owners: {}, lastSeen: {} };
  return store!;
}
async function saveStore() {
  await mkdir(path.dirname(PEOPLE_FILE), { recursive: true });
  await writeFile(PEOPLE_FILE, JSON.stringify(store, null, 2));
}

let cache: { at: number; clients: DecoClient[]; decos: { mac: string; name: string; online: boolean }[] } | null = null;

export async function decoOverview() {
  if (!cache || Date.now() - cache.at > 30_000) {
    const devs = await call<{ device_list: RawDeco[] }>('admin/device?form=device_list', { operation: 'read' });
    const decoName = new Map(devs.device_list.map((d) => [d.mac, decodeName(d.custom_nickname ?? '') || d.nickname || d.device_model || d.mac]));
    const raw = await call<{ client_list: RawClient[] }>('admin/client?form=client_list', { operation: 'read', params: { device_mac: 'default' } });
    const clients = raw.client_list
      .filter((c) => c.online !== false)
      .map((c) => ({
        mac: c.mac.toUpperCase(),
        name: decodeName(c.name) || c.mac,
        ip: c.ip ?? null,
        type: c.client_type ?? null,
        wired: c.wire_type === 'wired',
        // access_host er ofte et internt nummer, ikke en MAC – vis bare når det matcher en Deco
        deco: c.access_host ? (decoName.get(c.access_host) ?? null) : null,
        down: c.down_speed ?? 0,
        up: c.up_speed ?? 0,
        guest: c.interface === 'guest',
        band: c.connection_type?.startsWith('band') ? c.connection_type.slice(4).replace('_', '.') : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    const decos = devs.device_list.map((d) => ({
      mac: d.mac,
      name: decoName.get(d.mac)!,
      online: d.inet_status !== 'offline',
      model: d.device_model ?? null,
      firmware: d.software_ver ?? null,
      role: d.role ?? null,
    }));
    cache = { at: Date.now(), clients, decos };

    const s = await loadStore();
    const now = new Date().toISOString();
    for (const c of clients) if (s.owners[c.mac]) s.lastSeen[c.mac] = now;
    await saveStore();
  }
  return { ...cache, people: await people() };
}

async function people(): Promise<Person[]> {
  const s = await loadStore();
  const byName = new Map<string, string[]>();
  for (const [mac, name] of Object.entries(s.owners)) byName.set(name, [...(byName.get(name) ?? []), mac]);
  return [...byName]
    .map(([name, macs]) => {
      const seen = macs.map((m) => s.lastSeen[m]).filter(Boolean).sort().at(-1) ?? null;
      return { name, macs, lastSeen: seen, home: seen != null && Date.now() - new Date(seen).getTime() < HOME_GRACE_MS };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}

/** Knytt en enhet til en person (tomt navn fjerner koblingen). */
export async function decoSetOwner(mac: string, name: string) {
  const s = await loadStore();
  const m = mac.toUpperCase();
  const n = name.trim();
  if (n) {
    s.owners[m] = n.slice(0, 40);
    if (cache?.clients.some((c) => c.mac === m)) s.lastSeen[m] = new Date().toISOString();
  } else {
    delete s.owners[m];
    delete s.lastSeen[m];
  }
  await saveStore();
  return people();
}
