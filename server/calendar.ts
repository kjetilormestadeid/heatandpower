// Kalender fra ICS-abonnement(er): henter feeden, utvider gjentakelser og returnerer hendelser i et tidsvindu.
// URL-ene har ofte en hemmelig token, så de ligger i .env (CALENDAR_ICS_URL, kommaseparert for flere).

const CACHE_MS = 15 * 60_000;
const DAY = 86_400_000;

export class CalendarError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO-tidspunkt, eller YYYY-MM-DD for heldagshendelser */
  start: string;
  /** Eksklusiv slutt: ISO-tidspunkt, eller YYYY-MM-DD (dagen etter siste dag) for heldagshendelser */
  end: string;
  allDay: boolean;
  location: string | null;
  calendar: string | null;
}

const urls = () =>
  (process.env.CALENDAR_ICS_URL ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

export const calendarConfigured = () => urls().length > 0;

const cache = new Map<string, { at: number; text: string }>();

async function fetchIcs(url: string) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  const res = await fetch(url, { headers: { 'user-agent': 'mill-dashboard/0.1', accept: 'text/calendar' } });
  if (!res.ok) {
    // Bruk forrige versjon heller enn å tømme kalenderen ved et midlertidig brudd
    if (hit) return hit.text;
    throw new CalendarError(502, `Kalenderen svarte ${res.status}`);
  }
  const text = await res.text();
  cache.set(url, { at: Date.now(), text });
  return text;
}

/** Hendelser som overlapper [from, to), sortert på start. */
export async function calendarEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
  if (!calendarConfigured()) throw new CalendarError(503, 'CALENDAR_ICS_URL er ikke satt i .env');
  const texts = await Promise.all(urls().map(fetchIcs));
  const events = texts.flatMap((t) => expand(parse(t), from.getTime(), to.getTime()));
  return events.sort((a, b) => sortKey(a) - sortKey(b) || a.title.localeCompare(b.title, 'nb'));
}

// --- tolking ---

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Tidspunkt i en ICS-fil: kalenderdato pluss klokkeslett (null for heldag) i en sone (null = lokal tid). */
interface IcsTime {
  y: number;
  m: number;
  d: number;
  time: [number, number, number] | null;
  tz: string | null;
}

interface VEvent {
  uid: string;
  summary: string;
  location: string | null;
  start: IcsTime;
  end: IcsTime | null;
  rrule: Record<string, string> | null;
  exdates: number[];
  recurrenceId: number | null;
  cancelled: boolean;
}

interface Parsed {
  name: string | null;
  defaultTz: string | null;
  events: VEvent[];
}

function parse(text: string): Parsed {
  // Linjer som starter med mellomrom/tab er fortsettelser av forrige linje
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let name: string | null = null;
  let defaultTz: string | null = null;
  const events: VEvent[] = [];
  let cur: Prop[] | null = null;
  let depth = 0; // VALARM o.l. inne i VEVENT skal ikke blande seg inn

  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (p.value === 'VEVENT') (cur = []), (depth = 0);
      else if (cur) depth++;
      continue;
    }
    if (p.name === 'END') {
      if (p.value === 'VEVENT' && cur) {
        const ev = toEvent(cur, defaultTz);
        if (ev) events.push(ev);
        cur = null;
      } else if (cur) depth--;
      continue;
    }
    if (cur) {
      if (depth === 0) cur.push(p);
    } else if (p.name === 'X-WR-CALNAME') name = unescape(p.value);
    else if (p.name === 'X-WR-TIMEZONE') defaultTz = p.value;
  }
  return { name, defaultTz, events };
}

function parseLine(line: string): Prop | null {
  // Navn og parametre før første kolon som ikke står i anførselstegn
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name, ...rawParams] = line.slice(0, i).split(';');
  const params: Record<string, string> = {};
  for (const rp of rawParams) {
    const eq = rp.indexOf('=');
    if (eq > 0) params[rp.slice(0, eq).toUpperCase()] = rp.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

const unescape = (v: string) => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

function toEvent(props: Prop[], defaultTz: string | null): VEvent | null {
  const get = (n: string) => props.find((p) => p.name === n);
  const dtstart = get('DTSTART');
  if (!dtstart) return null;
  const start = parseTime(dtstart.value, dtstart.params, defaultTz);
  if (!start) return null;
  const dtend = get('DTEND');
  let end = dtend ? parseTime(dtend.value, dtend.params, defaultTz) : null;
  const duration = get('DURATION');
  if (!end && duration) end = addDuration(start, duration.value);
  const rrule = get('RRULE');
  const rid = get('RECURRENCE-ID');
  const ridTime = rid ? parseTime(rid.value, rid.params, defaultTz) : null;
  return {
    uid: get('UID')?.value ?? `${dtstart.value}-${get('SUMMARY')?.value ?? ''}`,
    summary: unescape(get('SUMMARY')?.value ?? '(uten tittel)'),
    location: get('LOCATION') ? unescape(get('LOCATION')!.value) || null : null,
    start,
    end,
    rrule: rrule ? Object.fromEntries(rrule.value.split(';').map((kv) => kv.split('=') as [string, string])) : null,
    exdates: props
      .filter((p) => p.name === 'EXDATE')
      .flatMap((p) => p.value.split(',').map((v) => parseTime(v, p.params, defaultTz)))
      .filter((t): t is IcsTime => t != null)
      .map(instantKey),
    recurrenceId: ridTime ? instantKey(ridTime) : null,
    cancelled: get('STATUS')?.value.toUpperCase() === 'CANCELLED',
  };
}

function parseTime(value: string, params: Record<string, string>, defaultTz: string | null): IcsTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const allDay = params.VALUE === 'DATE' || h == null;
  return {
    y: +y,
    m: +mo,
    d: +d,
    time: allDay ? null : [+h, +mi, +(s ?? 0)],
    tz: allDay ? null : z ? 'UTC' : (params.TZID ?? defaultTz),
  };
}

function addDuration(t: IcsTime, dur: string): IcsTime {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(dur);
  if (!m) return t;
  const [, w, d, h, mi, s] = m.map((x) => +(x ?? 0));
  const days = w * 7 + d;
  const date = shiftDate(t, days);
  if (!t.time) return date;
  const secs = t.time[0] * 3600 + t.time[1] * 60 + t.time[2] + h * 3600 + mi * 60 + s;
  const extra = Math.floor(secs / 86400);
  const rest = secs % 86400;
  return { ...shiftDate(date, extra), time: [Math.floor(rest / 3600), Math.floor((rest % 3600) / 60), rest % 60] };
}

// --- tid og soner ---

const dateNum = (t: Pick<IcsTime, 'y' | 'm' | 'd'>) => Date.UTC(t.y, t.m - 1, t.d);

function shiftDate<T extends IcsTime>(t: T, days: number): T {
  const dt = new Date(dateNum(t) + days * DAY);
  return { ...t, y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Hvor mange ms sonen ligger foran UTC ved tidspunktet `utc`. */
function tzOffset(utc: number, tz: string) {
  let f = offsetFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    offsetFormatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utc / 1000) * 1000;
}

/** Tidspunktet som UTC-ms. Heldagshendelser og lokal tid tolkes i serverens tidssone. */
function toUtc(t: IcsTime): number {
  const [h, mi, s] = t.time ?? [0, 0, 0];
  const wall = Date.UTC(t.y, t.m - 1, t.d, h, mi, s);
  if (t.tz === 'UTC') return wall;
  if (!t.tz || !t.time) return new Date(t.y, t.m - 1, t.d, h, mi, s).getTime();
  try {
    const guess = wall - tzOffset(wall, t.tz);
    return wall - tzOffset(guess, t.tz);
  } catch {
    return new Date(t.y, t.m - 1, t.d, h, mi, s).getTime(); // ukjent TZID
  }
}

/** Nøkkel for å kjenne igjen én forekomst (EXDATE/RECURRENCE-ID): UTC for tidspunkt, datoen for heldag. */
const instantKey = (t: IcsTime) => (t.time ? toUtc(t) : dateNum(t));

const ymd = (t: IcsTime) => `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;

function sortKey(e: CalendarEvent) {
  return e.allDay ? new Date(`${e.start}T00:00:00`).getTime() - 1 : Date.parse(e.start);
}

// --- gjentakelser ---

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const weekday = (t: IcsTime) => (new Date(dateNum(t)).getUTCDay() + 6) % 7; // 0 = mandag

/** Kalenderdatoer for forekomstene, fra DTSTART og fremover (i sonens veggklokke, så sommertid blir riktig). */
function* occurrences(ev: VEvent, untilMs: number): Generator<IcsTime> {
  const r = ev.rrule;
  if (!r) {
    yield ev.start;
    return;
  }
  const interval = Math.max(1, Number(r.INTERVAL ?? 1));
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? parseTime(r.UNTIL, {}, ev.start.tz) : null;
  const untilKey = until ? (ev.start.time ? toUtc(until) : dateNum(until)) : Infinity;
  const byDay = r.BYDAY?.split(',').map((d) => WEEKDAYS.indexOf(d.slice(-2))).filter((d) => d >= 0) ?? [];
  let n = 0;

  const emit = function* (t: IcsTime) {
    if (instantKey(t) > untilKey || n >= count) return false;
    n++;
    yield t;
    return true;
  };

  for (let step = 0; step < 5000; step++) {
    let candidates: IcsTime[];
    if (r.FREQ === 'DAILY') candidates = [shiftDate(ev.start, step * interval)];
    else if (r.FREQ === 'WEEKLY') {
      const days = byDay.length ? byDay : [weekday(ev.start)];
      const monday = shiftDate(ev.start, -weekday(ev.start) + step * 7 * interval);
      candidates = [...days].sort().map((d) => shiftDate(monday, d)).filter((t) => dateNum(t) >= dateNum(ev.start));
    } else if (r.FREQ === 'MONTHLY' || r.FREQ === 'YEARLY') {
      const months = r.FREQ === 'MONTHLY' ? step * interval : step * interval * 12;
      const mIdx = ev.start.m - 1 + months;
      const t = { ...ev.start, y: ev.start.y + Math.floor(mIdx / 12), m: (mIdx % 12) + 1 };
      // Hopp over måneder der datoen ikke finnes (31. i en kort måned)
      candidates = new Date(dateNum(t)).getUTCDate() === t.d ? [t] : [];
    } else {
      yield ev.start;
      return;
    }
    for (const t of candidates) {
      if (!(yield* emit(t))) return;
    }
    const last = candidates.at(-1) ?? shiftDate(ev.start, step);
    if (instantKey(last) > untilMs) return;
  }
}

function expand(cal: Parsed, from: number, to: number): CalendarEvent[] {
  // Enkeltforekomster som er flyttet/endret (RECURRENCE-ID) erstatter forekomsten i serien
  const overridden = new Set(cal.events.filter((e) => e.recurrenceId != null).map((e) => `${e.uid}|${e.recurrenceId}`));
  const out: CalendarEvent[] = [];

  for (const ev of cal.events) {
    const lengthMs = ev.end && ev.start.time ? toUtc(ev.end) - toUtc(ev.start) : 0;
    const lengthDays = ev.end && !ev.start.time ? Math.max(1, Math.round((dateNum(ev.end) - dateNum(ev.start)) / DAY)) : 1;

    for (const t of occurrences(ev, to + DAY)) {
      const key = instantKey(t);
      if (ev.cancelled || ev.exdates.includes(key)) continue;
      if (ev.recurrenceId == null && overridden.has(`${ev.uid}|${key}`)) continue;
      const start = t.time ? toUtc(t) : toUtc({ ...t, time: null });
      const end = t.time ? start + lengthMs : toUtc(shiftDate(t, lengthDays));
      if (end <= from && !(end === start && start >= from)) continue;
      if (start >= to) continue;
      out.push({
        id: `${ev.uid}|${key}`,
        title: ev.summary,
        start: t.time ? new Date(start).toISOString() : ymd(t),
        end: t.time ? new Date(end).toISOString() : ymd(shiftDate(t, lengthDays)),
        allDay: !t.time,
        location: ev.location,
        calendar: cal.name,
      });
    }
  }
  return out;
}
