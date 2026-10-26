// fetch som tåler korte nettbrudd (svak Wi-Fi på nettbrettet): feiler oppkoblingen før noe er sendt
// – DNS-oppslag, tidsavbrudd eller avvist tilkobling – prøves kallet på nytt etter 1 s og så 3 s.
// Da har tjenesten ikke sett forespørselen, så det er trygt også for kommandoer (POST/PUT).
// Feil etter at forespørselen er sendt, og svar med feilstatus, gis videre som før.

const RETRY_DELAYS_MS = [1_000, 3_000];

const CONNECT_ERRORS = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'EADDRNOTAVAIL',
]);

/** Feilkoden fra undici ligger i `cause`, ved Happy Eyeballs i `cause.errors[]`. */
function connectFailed(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false; // AbortError/TimeoutError fra signal skal ikke prøves igjen
  const cause = (err as { cause?: { code?: string; errors?: { code?: string }[] } }).cause;
  if (!cause) return false;
  if (cause.code && CONNECT_ERRORS.has(cause.code)) return true;
  return Boolean(cause.errors?.length && cause.errors.every((e) => e.code && CONNECT_ERRORS.has(e.code)));
}

function wait(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });
}

export async function fetchRetry(input: string | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !connectFailed(err)) throw err;
      const host = new URL(input).host;
      const code = (err as { cause?: { code?: string } }).cause?.code ?? 'nettfeil';
      console.warn(`${host}: ${code} – prøver igjen om ${RETRY_DELAYS_MS[attempt] / 1000} s`);
      await wait(RETRY_DELAYS_MS[attempt], init?.signal);
    }
  }
}
