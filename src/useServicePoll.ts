import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

/** Returneres av henteren når tjenesten ikke er satt opp: da skjules den, og vi slutter å spørre. */
export const OFF = Symbol('off');

// Nede: prøv igjen etter 15 s, så 30 s, 60 s, 120 s, 240 s – deretter hvert 5. minutt til den svarer
const RETRY_FIRST_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;
/** Pauser mellom hentingene rett etter en endring (2 s, så 5, 10 og 20 s etter), før vanlig intervall. */
export const BURST_MS = [2_000, 3_000, 5_000, 10_000];

export const retryDelay = (failures: number) => Math.min(RETRY_FIRST_MS * 2 ** (failures - 1), RETRY_MAX_MS);

/**
 * Kjører `run` nå og så hvert `everyMs` mens fanen er synlig. Returnerer `run` false (feilet),
 * trappes pausen ned som i useServicePoll til den lykkes igjen. Gir tilbake en stopp-funksjon.
 */
export function pollWithBackoff(run: () => Promise<boolean>, everyMs: number) {
  let stop = false;
  let t: number | undefined;
  let failures = 0;
  let first = true;
  const schedule = () => (t = window.setTimeout(tick, failures ? retryDelay(failures) : everyMs));
  async function tick() {
    if (first || document.visibilityState === 'visible') {
      first = false;
      const ok = await run().catch(() => false);
      if (stop) return;
      failures = ok ? 0 : failures + 1;
    }
    schedule();
  }
  tick();
  return () => {
    stop = true;
    window.clearTimeout(t);
  };
}

/**
 * Henter data jevnlig og tåler at tjenesten er nede: ved feil beholdes siste data og `down` blir true,
 * så flisene kan vises rolig som «ingen kontakt». Mens den er nede prøves det med økende pause
 * (15 s → 5 min), og når et kall lykkes igjen blir `down` false og vanlig intervall gjelder.
 * Spør bare mens fanen er synlig.
 */
export function useServicePoll<T>(fetcher: (prev: T | null) => Promise<T | typeof OFF>, everyMs: number, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [down, setDown] = useState(false);
  const [kick, setKick] = useState(0);
  const burstRef = useRef<() => void>(() => {});
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const dataRef = useRef<T | null>(null);
  dataRef.current = data;

  useEffect(() => {
    let stop = false;
    let t: number | undefined;
    let failures = 0;
    let burst: number[] = [];
    const schedule = (ms: number) => {
      window.clearTimeout(t);
      t = window.setTimeout(run, burst.length ? burst.shift()! : ms);
    };
    burstRef.current = () => {
      burst = [...BURST_MS];
      schedule(0);
    };
    async function run() {
      if (document.visibilityState !== 'visible') return void schedule(failures ? retryDelay(failures) : everyMs);
      try {
        const r = await fetchRef.current(dataRef.current);
        if (stop) return;
        failures = 0;
        setDown(false);
        if (r === OFF) return void setData(null);
        setData(r);
        schedule(everyMs);
      } catch {
        if (stop) return;
        failures++;
        setDown(true);
        schedule(retryDelay(failures));
      }
    }
    run();
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyMs, kick, ...deps]);

  const reload = useCallback(() => setKick((k) => k + 1), []);
  /** Hent tett en liten stund (etter at noe er slått av/på), så ny status kommer fort inn. */
  const burst = useCallback(() => burstRef.current(), []);
  return { data, setData, down, reload, burst };
}
