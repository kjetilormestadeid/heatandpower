// Gjenkjenning av apparater fra Tibber Pulse: hele husets forbruk måles, og når noe slås av/på
// gir det et trinn i kurven. I «identifiser»-modus slår brukeren et apparat på og av, OpenAI (eller
// en enkel lokal analyse) finner effekten, og brukeren gir det et navn. Senere kjennes trinn med
// samme størrelse igjen, slik at vi vet hva som står på.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { type PowerSample, onPowerSample, powerHistory, tibberConfigured, tibberKeepAlive } from './tibber.ts';

const FILE = path.resolve('data/appliances.json');
/** Minste endring (W) som regnes som at noe slås av/på */
const MIN_STEP = 150;
/** Vindu før/etter et trinn (ms) – nivået må holde seg så lenge */
const WIN = 20_000;
const IDENTIFY_MAX_MS = 15 * 60_000;

export interface Appliance {
  id: string;
  name: string;
  /** Effekt når den står på (W) */
  watts: number;
  createdAt: string;
  /** Hvordan effekten ble funnet */
  source: 'ai' | 'local' | 'manual';
}

export interface ApplianceState extends Appliance {
  on: boolean;
  /** Når tilstanden sist endret seg (ISO), null = ukjent */
  since: string | null;
}

export interface PowerStep {
  /** ms siden epoch */
  t: number;
  /** Endring i W (+ på, − av) */
  delta: number;
  /** Navnet på apparatet trinnet ble koblet til, null = ukjent */
  match: string | null;
}

export interface IdentifyAnalysis {
  found: boolean;
  watts: number | null;
  /** Sekunder etter start */
  onAtSec: number | null;
  offAtSec: number | null;
  confidence: 'høy' | 'middels' | 'lav';
  explanation: string;
  source: 'ai' | 'local';
}

export class ApplianceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const openaiConfigured = () => Boolean(process.env.OPENAI_API_KEY);

let appliances: Appliance[] | null = null;
const state = new Map<string, { on: boolean; since: string | null }>();
const events: PowerStep[] = [];
let identifyStartedAt: number | null = null;
let identifyTimer: ReturnType<typeof setTimeout> | null = null;

async function load() {
  if (!appliances) appliances = existsSync(FILE) ? (JSON.parse(await readFile(FILE, 'utf8')).appliances ?? []) : [];
  return appliances!;
}
async function save() {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify({ appliances }, null, 2));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Finn trinn i en serie: ved hvert punkt sammenlignes median før og etter (WIN ms hver vei).
 * Bare de største endringene beholdes, minst WIN fra hverandre.
 */
export function findSteps(samples: PowerSample[], minStep = MIN_STEP): { t: number; delta: number }[] {
  const last = samples.at(-1)?.t ?? 0;
  const cands: { t: number; delta: number }[] = [];
  for (const s of samples) {
    if (s.t + WIN * 0.9 > last) break; // etter-vinduet må være (nesten) fullt
    const before = samples.filter((x) => x.t >= s.t - WIN && x.t < s.t).map((x) => x.w);
    const after = samples.filter((x) => x.t >= s.t && x.t <= s.t + WIN).map((x) => x.w);
    if (before.length < 3 || after.length < 3) continue;
    const delta = median(after) - median(before);
    if (Math.abs(delta) >= minStep) cands.push({ t: s.t, delta: Math.round(delta) });
  }
  const picked: typeof cands = [];
  for (const c of [...cands].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))) {
    if (picked.every((p) => Math.abs(p.t - c.t) >= WIN)) picked.push(c);
  }
  return picked.sort((a, b) => a.t - b.t);
}

const tolerance = (w: number) => Math.max(60, w * 0.15);

/** Koble et trinn til apparatet med nærmest effekt som har motsatt tilstand. */
function matchStep(delta: number): Appliance | null {
  const on = delta > 0;
  let best: Appliance | null = null;
  for (const a of appliances ?? []) {
    if ((state.get(a.id)?.on ?? false) === on) continue;
    const err = Math.abs(a.watts - Math.abs(delta));
    if (err <= tolerance(a.watts) && (!best || err < Math.abs(best.watts - Math.abs(delta)))) best = a;
  }
  return best;
}

let lastEventAt = 0;
function onSample(sample: PowerSample) {
  // Under identifisering er det brukeren som slår av/på – ikke tolk det som kjente apparater
  if (identifyStartedAt) return;
  const recent = powerHistory(sample.t - 2 * WIN - 10_000);
  for (const step of findSteps(recent)) {
    if (step.t <= lastEventAt + WIN) continue;
    lastEventAt = step.t;
    const a = matchStep(step.delta);
    if (a) state.set(a.id, { on: step.delta > 0, since: new Date(step.t).toISOString() });
    events.push({ ...step, match: a?.name ?? null });
    if (events.length > 30) events.shift();
  }
  // Kan ikke stå på mer enn det huset trekker totalt
  for (const a of appliances ?? []) {
    const s = state.get(a.id);
    if (s?.on && sample.w < a.watts * 0.8) state.set(a.id, { on: false, since: new Date(sample.t).toISOString() });
  }
}

/** Start sporing: hold Pulse-tilkoblingen åpen så lenge det finnes lagrede apparater. */
export async function startApplianceTracking() {
  await load();
  onPowerSample(onSample);
  if (tibberConfigured() && appliances!.length) tibberKeepAlive(true);
}

export async function applianceStates(): Promise<{ appliances: ApplianceState[]; events: PowerStep[]; aiConfigured: boolean; identifying: boolean }> {
  const list = await load();
  return {
    appliances: list.map((a) => ({ ...a, ...(state.get(a.id) ?? { on: false, since: null }) })),
    events: [...events].reverse(),
    aiConfigured: openaiConfigured(),
    identifying: identifyStartedAt != null,
  };
}

export async function addAppliance(name: string, watts: number, source: Appliance['source']) {
  const list = await load();
  const a: Appliance = { id: randomUUID(), name: name.trim(), watts: Math.round(watts), createdAt: new Date().toISOString(), source };
  list.push(a);
  await save();
  // Brukeren slo det nettopp av under identifiseringen
  state.set(a.id, { on: false, since: new Date().toISOString() });
  if (tibberConfigured()) tibberKeepAlive(true);
  return a;
}

export async function removeAppliance(id: string) {
  const list = await load();
  appliances = list.filter((a) => a.id !== id);
  state.delete(id);
  await save();
  if (!appliances.length && !identifyStartedAt) tibberKeepAlive(false);
}

/** Manuell korreksjon når gjenkjenningen har bommet. */
export async function setApplianceOn(id: string, on: boolean) {
  const list = await load();
  if (!list.some((a) => a.id === id)) throw new ApplianceError(404, 'Fant ikke apparatet');
  state.set(id, { on, since: new Date().toISOString() });
}

// --- Identifiser-modus ---

function stopIdentify() {
  identifyStartedAt = null;
  if (identifyTimer) clearTimeout(identifyTimer);
  identifyTimer = null;
  if (!appliances?.length) tibberKeepAlive(false);
}

export function startIdentify() {
  if (!tibberConfigured()) throw new ApplianceError(503, 'TIBBER_TOKEN er ikke satt i .env');
  if (identifyTimer) clearTimeout(identifyTimer);
  identifyStartedAt = Date.now();
  identifyTimer = setTimeout(stopIdentify, IDENTIFY_MAX_MS);
  tibberKeepAlive(true);
  return { startedAt: new Date(identifyStartedAt).toISOString() };
}

export function cancelIdentify() {
  stopIdentify();
}

/** Målinger siden identifiseringen startet. */
export function identifySamples() {
  return { startedAt: identifyStartedAt && new Date(identifyStartedAt).toISOString(), samples: identifyStartedAt ? powerHistory(identifyStartedAt) : [] };
}

/** Lokal analyse: største trinn opp etterfulgt av et trinn ned av omtrent samme størrelse. */
function localAnalysis(samples: PowerSample[], start: number): IdentifyAnalysis {
  const steps = findSteps(samples);
  let best: { up: (typeof steps)[0]; down: (typeof steps)[0] | null } | null = null;
  for (const up of steps.filter((s) => s.delta > 0)) {
    const down = steps.find((s) => s.t > up.t && s.delta < 0 && Math.abs(-s.delta - up.delta) <= tolerance(up.delta)) ?? null;
    if (!best || (down && !best.down) || (!!down === !!best.down && up.delta > best.up.delta)) best = { up, down };
  }
  if (!best) {
    return { found: false, watts: null, onAtSec: null, offAtSec: null, confidence: 'lav', explanation: `Fant ingen tydelig endring på over ${MIN_STEP} W.`, source: 'local' };
  }
  const watts = Math.round(best.down ? (best.up.delta - best.down.delta) / 2 : best.up.delta);
  const sec = (t: number) => Math.round((t - start) / 1000);
  return {
    found: true,
    watts,
    onAtSec: sec(best.up.t),
    offAtSec: best.down ? sec(best.down.t) : null,
    confidence: best.down ? 'middels' : 'lav',
    explanation: best.down
      ? `Forbruket økte med ${best.up.delta} W og falt med ${-best.down.delta} W igjen.`
      : `Forbruket økte med ${best.up.delta} W, men falt ikke tydelig tilbake.`,
    source: 'local',
  };
}

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'watts', 'onAtSec', 'offAtSec', 'confidence', 'explanation'],
  properties: {
    found: { type: 'boolean', description: 'Om det finnes et tydelig apparat som ble slått på og av' },
    watts: { type: ['number', 'null'], description: 'Apparatets effekt i watt' },
    onAtSec: { type: ['number', 'null'], description: 'Sekunder etter start da det ble slått på' },
    offAtSec: { type: ['number', 'null'], description: 'Sekunder etter start da det ble slått av' },
    confidence: { type: 'string', enum: ['høy', 'middels', 'lav'] },
    explanation: { type: 'string', description: 'Kort forklaring på norsk (1–2 setninger)' },
  },
};

async function aiAnalysis(samples: PowerSample[], start: number, local: IdentifyAnalysis): Promise<IdentifyAnalysis> {
  // Maks ~300 punkter: ta snittet per bøtte
  const bucket = Math.max(1, Math.ceil(samples.length / 300));
  const rows: string[] = [];
  for (let i = 0; i < samples.length; i += bucket) {
    const part = samples.slice(i, i + bucket);
    rows.push(`${Math.round((part[0].t - start) / 1000)}\t${Math.round(part.reduce((s, x) => s + x.w, 0) / part.length)}`);
  }
  const steps = findSteps(samples).map((s) => `${Math.round((s.t - start) / 1000)} s: ${s.delta > 0 ? '+' : ''}${s.delta} W`);
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      input: [
        {
          role: 'system',
          content:
            'Du analyserer strømforbruket til et helt hus (Tibber Pulse, watt). Brukeren har slått ett apparat på og deretter av ' +
            'for å identifisere det. Finn trinnet opp og ned som hører til apparatet, og anslå effekten. Se bort fra støy og ' +
            'andre apparater som går av og på (f.eks. varmtvannsbereder, kjøleskap, ovner med termostat). Termostatstyrte ' +
            'apparater kan ha en innkoblingstopp; oppgi effekten i stabil drift.',
        },
        {
          role: 'user',
          content: `Målinger (sekunder etter start<TAB>watt):\n${rows.join('\n')}\n\nAutomatisk funne trinn:\n${steps.join('\n') || 'ingen'}`,
        },
      ],
      text: { format: { type: 'json_schema', name: 'appliance_signature', strict: true, schema: ANALYSIS_SCHEMA } },
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    output?: { type: string; content?: { type: string; text?: string }[] }[];
    error?: { message: string };
  } | null;
  if (!res.ok) throw new ApplianceError(502, `OpenAI: ${body?.error?.message ?? res.status}`);
  const text = body?.output?.flatMap((o) => o.content ?? []).find((c) => c.type === 'output_text')?.text;
  if (!text) return local;
  const r = JSON.parse(text) as Omit<IdentifyAnalysis, 'source'>;
  return { ...r, watts: r.watts != null ? Math.round(r.watts) : null, source: 'ai' };
}

/** Analyser målingene siden start. Identifiseringen avsluttes (sporing gjenopptas). */
export async function analyzeIdentify(): Promise<{ analysis: IdentifyAnalysis; samples: PowerSample[]; startedAt: string }> {
  if (!identifyStartedAt) throw new ApplianceError(409, 'Identifisering er ikke startet');
  const start = identifyStartedAt;
  const samples = powerHistory(start);
  if (samples.length < 10) throw new ApplianceError(409, 'For få målinger ennå – vent litt til');
  const local = localAnalysis(samples, start);
  let analysis = local;
  if (openaiConfigured()) {
    try {
      analysis = await aiAnalysis(samples, start, local);
    } catch (err) {
      console.error(err);
      analysis = { ...local, explanation: `${local.explanation} (OpenAI feilet – lokal analyse brukt.)` };
    }
  }
  stopIdentify();
  lastEventAt = Date.now(); // ikke tolk det brukeren nettopp gjorde som nye hendelser
  return { analysis, samples, startedAt: new Date(start).toISOString() };
}
