// Hva strømmen faktisk koster oss: Norgespris + Tibbers påslag/fastbeløp + nettleie hos Elvia (standard forbrukertariff).
// Alle satser er inkl. mva, elavgift og Enova-avgift. Oppdater tabellen når Elvia/staten endrer prisene.

/** Norgespris (fast pris fra staten, lik i hele landet), øre/kWh inkl. mva. 40 øre eks. mva ut 2026. */
const NORGESPRIS_ORE = 50;
/** Påslag fra Tibber (elsertifikater o.l.), øre/kWh inkl. mva – oppgitt som «maks», så dette er øvre grense. */
const SUPPLIER_ORE = 3.4;
/** Fastbeløp til Tibber, kr/mnd inkl. mva. */
const SUPPLIER_MONTHLY_KR = 49;
/** Kapasitetstrinnet vi ligger på (snittet av de tre høyeste døgnmaksene i måneden). */
const CAPACITY_STEP = '10-15 kW';

interface Tariff {
  from: string; // YYYY-MM-DD, gjelder fra og med
  dayOre: number; // hverdager 06–22
  nightOre: number; // hverdager 22–06, helg og helligdager
  capacityKr: Record<string, number>; // fastledd kr/mnd per trinn
}

// https://www.elvia.no/nettleie/ – tariffblad 1.0 standard tariff privat
const ELVIA: Tariff[] = [
  { from: '2026-01-01', dayOre: 36.4, nightOre: 26.4, capacityKr: { '10-15 kW': 410 } },
  { from: '2026-07-01', dayOre: 46.4, nightOre: 31.4, capacityKr: { '10-15 kW': 585 } },
];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function tariffAt(d: Date) {
  const key = ymd(d);
  return ELVIA.filter((t) => t.from <= key).at(-1) ?? ELVIA[0];
}

/** Påskedag (gregoriansk), via Meeus/Jones/Butcher. */
function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return new Date(year, month - 1, ((h + l - 7 * m + 114) % 31) + 1);
}

const holidayCache = new Map<number, Set<string>>();

/** Norske helligdager (røde dager) – Elvia regner dem som helg. */
function holidays(year: number) {
  let set = holidayCache.get(year);
  if (!set) {
    const e = easter(year);
    const rel = (n: number) => ymd(new Date(e.getFullYear(), e.getMonth(), e.getDate() + n));
    set = new Set([
      `${year}-01-01`, `${year}-05-01`, `${year}-05-17`, `${year}-12-25`, `${year}-12-26`,
      rel(-3), rel(-2), rel(0), rel(1), // skjærtorsdag, langfredag, 1. og 2. påskedag
      rel(39), rel(49), rel(50), // Kristi himmelfart, 1. og 2. pinsedag
    ]);
    holidayCache.set(year, set);
  }
  return set;
}

/** Nettleiens energiledd for timen som starter i `d`, øre/kWh. */
export function gridOre(d: Date) {
  const t = tariffAt(d);
  const weekend = d.getDay() === 0 || d.getDay() === 6 || holidays(d.getFullYear()).has(ymd(d));
  const h = d.getHours();
  return !weekend && h >= 6 && h < 22 ? t.dayOre : t.nightOre;
}

const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** Fastleddets andel for døgnet `d`, kr (månedsbeløpet fordelt likt på dagene i måneden). */
export function capacityKrPerDay(d: Date) {
  return (tariffAt(d).capacityKr[CAPACITY_STEP] ?? 0) / daysInMonth(d);
}

export interface DayCost {
  /** Norgespris + Tibbers påslag, kr */
  energy: number;
  /** Nettleiens energiledd, kr */
  grid: number;
  /** Dagens andel av faste månedsbeløp: Elvias fastledd + Tibbers fastbeløp, kr */
  fixed: number;
  total: number;
}

/** Kostnad for timeforbruk (kWh per time, med timens start) i løpet av ett døgn. */
export function dayCost(day: Date, hours: { from: Date; kwh: number }[]): DayCost {
  const kwh = hours.reduce((s, h) => s + h.kwh, 0);
  const energy = (kwh * (NORGESPRIS_ORE + SUPPLIER_ORE)) / 100;
  const grid = hours.reduce((s, h) => s + (h.kwh * gridOre(h.from)) / 100, 0);
  const fixed = capacityKrPerDay(day) + SUPPLIER_MONTHLY_KR / daysInMonth(day);
  return { energy, grid, fixed, total: energy + grid + fixed };
}
