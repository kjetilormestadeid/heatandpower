import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import type { AppliancesResponse, IdentifyAnalysis, PowerSample, PowerStepRaw } from '../types';

const fmtW = (w: number) => (w >= 1000 ? `${(w / 1000).toLocaleString('nb-NO', { maximumFractionDigits: 2 })} kW` : `${Math.round(w)} W`);
const fmtDelta = (w: number) => `${w > 0 ? '+' : '−'}${fmtW(Math.abs(w))}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
/** Nok tid til å slå på, vente og slå av igjen */
const MIN_RECORD_S = 40;
/** Sekunder som brukes til å måle grunnlasten før apparatet slås på */
const BASELINE_S = 10;
/** Hvor lenge apparatet bør stå på før det slås av */
const ON_HOLD_S = 25;

type Phase =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'analyzing' }
  | { kind: 'result'; analysis: IdentifyAnalysis; samples: PowerSample[]; startedAt: number };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
};

/** Hvor langt brukeren har kommet, ut fra trinnene backend har funnet så langt. */
function progress(samples: PowerSample[], steps: PowerStepRaw[], startedAt: number, now: number) {
  const elapsed = (now - startedAt) / 1000;
  const baseline = median(samples.filter((s) => s.t < startedAt + BASELINE_S * 1000).map((s) => s.w));
  const up = steps.filter((s) => s.delta > 0).sort((a, b) => b.delta - a.delta)[0] ?? null;
  const down = up ? steps.find((s) => s.t > up.t && s.delta < 0 && Math.abs(s.delta + up.delta) <= Math.max(60, up.delta * 0.25)) ?? null : null;
  const onFor = up ? ((down?.t ?? now) - up.t) / 1000 : 0;
  const noisy = steps.length > (down ? 2 : up ? 1 : 0);

  let tone: 'wait' | 'act' | 'ok' = 'act';
  let text: string;
  if (elapsed < BASELINE_S || baseline == null) {
    tone = 'wait';
    text = 'Måler grunnlasten i huset – ikke slå på noe ennå.';
  } else if (!up) {
    text = `Grunnlast ≈ ${fmtW(baseline)}. Slå apparatet PÅ nå. Det tar ca. 20 sekunder før økningen vises her.`;
  } else if (!down && onFor < ON_HOLD_S) {
    tone = 'wait';
    text = `Ser en økning på ${fmtDelta(up.delta)}. La apparatet stå på litt til (${Math.ceil(ON_HOLD_S - onFor)} s).`;
  } else if (!down) {
    text = `Økning på ${fmtDelta(up.delta)} registrert. Slå apparatet AV nå.`;
  } else {
    tone = 'ok';
    text = `På ${fmtDelta(up.delta)} og av ${fmtDelta(down.delta)}. Dette ser ut som et apparat på ca. ${fmtW((up.delta - down.delta) / 2)}. Trykk «Analyser».`;
  }
  return { elapsed: Math.round(elapsed), baseline, up, down, tone, text, noisy };
}

/**
 * Identifiser-modus: brukeren slår et apparat på og av mens Tibber Pulse måler hele huset.
 * Forbruket analyseres (OpenAI eller lokalt), og apparatet lagres med navn og effekt.
 */
export function IdentifyAppliance({ data, onChange }: { data: AppliancesResponse | null; onChange: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [samples, setSamples] = useState<PowerSample[]>([]);
  const [steps, setSteps] = useState<PowerStepRaw[]>([]);
  const [now, setNow] = useState(Date.now());
  const [name, setName] = useState('');
  const [watts, setWatts] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (phase.kind !== 'recording') return;
    const poll = () => {
      setNow(Date.now());
      api.identifySamples().then((r) => (setSamples(r.samples), setSteps(r.steps)), () => {});
    };
    poll();
    const t = setInterval(poll, 2_000);
    return () => clearInterval(t);
  }, [phase.kind]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Noe gikk galt');
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => {
      const r = await api.identifyStart();
      setSamples([]);
      setSteps([]);
      setPhase({ kind: 'recording', startedAt: new Date(r.startedAt).getTime() });
    });

  const analyze = (recording: Phase) =>
    run(async () => {
      setPhase({ kind: 'analyzing' });
      try {
        const r = await api.identifyAnalyze(name);
        setWatts(r.analysis.watts != null ? String(r.analysis.watts) : '');
        setPhase({ kind: 'result', analysis: r.analysis, samples: r.samples, startedAt: new Date(r.startedAt).getTime() });
      } catch (e) {
        // Serveren tar fortsatt opp hvis det var for få målinger – fortsett der
        setPhase(e instanceof ApiError && e.status === 409 && e.message.startsWith('For få') ? recording : { kind: 'idle' });
        throw e;
      }
    });

  const cancel = () => run(async () => { await api.identifyCancel(); setPhase({ kind: 'idle' }); });

  const save = (source: 'ai' | 'local' | 'manual') =>
    run(async () => {
      await api.addAppliance({ name: name.trim(), watts: Number(watts), source });
      setName('');
      setPhase({ kind: 'idle' });
      onChange();
    });

  const nameInput = (
    <input
      className="identify-name"
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="Hva er det? F.eks. Varmekabler bad"
      aria-label="Hva slags apparat"
      maxLength={60}
    />
  );

  const p = phase.kind === 'recording' ? progress(samples, steps, phase.startedAt, now) : null;
  const current = samples.at(-1)?.w;

  return (
    <div className="identify">
      <div className="section-head">
        <h3>Identifiser apparat</h3>
        <div className="spacer" />
        {data && <span className="muted small">{data.aiConfigured ? 'Analyse med OpenAI' : 'Lokal analyse (OPENAI_API_KEY ikke satt)'}</span>}
      </div>

      {error && <p className="error small">{error}</p>}

      {phase.kind === 'idle' && (
        <>
          <p className="small" style={{ margin: 0 }}>
            Tibber Pulse måler forbruket i hele huset. Når du slår et apparat <strong>på</strong> og så <strong>av</strong>, ser vi
            hvor mye forbruket hopper, og da vet vi hvor mye apparatet trekker. Etterpå kjenner systemet det igjen når det slår
            seg av og på av seg selv, f.eks. varmekabler med termostat.
          </p>
          <ul className="identify-tips small muted">
            <li>Apparatet bør trekke minst 150 W. Små ting som ladere og lamper er vanskelige å skille fra støy.</li>
            <li>Unngå å bruke komfyr, vaskemaskin og lignende samtidig.</li>
            <li>For apparater med termostat: skru temperaturen høyt, så du er sikker på at det trekker strøm.</li>
          </ul>
          <label className="period-row">
            <span className="small">Hva skal du identifisere?</span>
            {nameInput}
          </label>
          <button className="primary" disabled={busy} onClick={start}>Start identifisering</button>
        </>
      )}

      {phase.kind === 'recording' && p && (
        <>
          <ol className="identify-steps small">
            <li className={p.elapsed >= BASELINE_S ? 'done' : 'current'}>Måler grunnlast ({BASELINE_S} s)</li>
            <li className={p.up ? 'done' : p.elapsed >= BASELINE_S ? 'current' : ''}>Slå apparatet <strong>på</strong></li>
            <li className={p.down ? 'done' : p.up ? 'current' : ''}>La det stå ca. {ON_HOLD_S} s, og slå det <strong>av</strong></li>
            <li className={p.down ? 'current' : ''}>Trykk «Analyser»</li>
          </ol>
          <p className={`identify-status small ${p.tone}`} role="status">{p.text}</p>
          {p.noisy && (
            <p className="muted small" style={{ margin: 0 }}>
              Det er flere endringer i forbruket. Noe annet kan ha slått seg av eller på, men analysen prøver å skille dem fra hverandre.
            </p>
          )}
          <div className="tiles">
            <div className="tile">
              <span className="muted small">Hele huset nå</span>
              <strong className="now-total">{current != null ? fmtW(current) : '–'}</strong>
            </div>
            {p.baseline != null && current != null && p.elapsed >= BASELINE_S && (
              <div className="tile">
                <span className="muted small">Endring fra grunnlast</span>
                <strong>{Math.abs(current - p.baseline) < 50 ? '±0 W' : fmtDelta(current - p.baseline)}</strong>
              </div>
            )}
            <div className="tile">
              <span className="muted small">Tid</span>
              <strong>{p.elapsed} s</strong>
            </div>
          </div>
          <PowerCurve samples={samples} startedAt={phase.startedAt} baseline={p.elapsed >= BASELINE_S ? p.baseline : null} steps={steps} />
          <label className="period-row">
            <span className="small">Hva er det?</span>
            {nameInput}
          </label>
          <div className="period-row">
            <button className="primary" disabled={busy || p.elapsed < MIN_RECORD_S} onClick={() => analyze(phase)}>
              Analyser{p.elapsed < MIN_RECORD_S ? ` (om ${MIN_RECORD_S - p.elapsed} s)` : ''}
            </button>
            <button disabled={busy} onClick={cancel}>Avbryt</button>
          </div>
        </>
      )}

      {phase.kind === 'analyzing' && <p className="muted small">Analyserer forbruket{name.trim() ? ` for «${name.trim()}»` : ''}…</p>}

      {phase.kind === 'result' && (
        <>
          <p className={`identify-status small ${phase.analysis.found ? 'ok' : 'act'}`}>
            {phase.analysis.found ? (
              <>Fant et apparat på <strong>{fmtW(phase.analysis.watts ?? 0)}</strong> · sikkerhet {phase.analysis.confidence}. </>
            ) : (
              <strong>Fant ikke noe tydelig apparat. </strong>
            )}
            {phase.analysis.explanation}
          </p>
          <PowerCurve
            samples={phase.samples}
            startedAt={phase.startedAt}
            marks={[
              ...(phase.analysis.onAtSec != null ? [{ sec: phase.analysis.onAtSec, label: 'på', cls: 'mark-on' }] : []),
              ...(phase.analysis.offAtSec != null ? [{ sec: phase.analysis.offAtSec, label: 'av', cls: 'mark-off' }] : []),
            ]}
          />
          <p className="muted small" style={{ margin: 0 }}>
            Gi apparatet et navn og sjekk effekten. Du kan rette tallet hvis du vet bedre, f.eks. fra typeskiltet.
          </p>
          <form
            className="period-row"
            onSubmit={(e) => {
              e.preventDefault();
              const edited = Number(watts) !== phase.analysis.watts;
              save(edited ? 'manual' : phase.analysis.source);
            }}
          >
            {nameInput}
            <input type="number" min={1} max={50000} value={watts} onChange={(e) => setWatts(e.target.value)} style={{ width: 90 }} aria-label="Effekt i watt" />
            <span className="muted small">W</span>
            <button className="primary" type="submit" disabled={busy || !name.trim() || !(Number(watts) > 0)}>Lagre</button>
            <button type="button" disabled={busy} onClick={start}>Prøv igjen</button>
            <button type="button" className="link" onClick={() => setPhase({ kind: 'idle' })}>Avbryt</button>
          </form>
        </>
      )}

      {data && data.appliances.length > 0 && (
        <div className="status-group">
          <div className="small"><strong>Kjente apparater</strong> <span className="muted">({data.appliances.length})</span></div>
          <ul className="known-appliances">
            {data.appliances.map((a) => (
              <li key={a.id}>
                <span className={`dot ${a.on ? 'on' : 'off'}`} aria-hidden />
                <span>
                  <strong>{a.name}</strong> <span className="muted small">· {fmtW(a.watts)}{a.since ? ` · ${a.on ? 'på' : 'av'} siden ${time(a.since)}` : ''}</span>
                </span>
                <div className="spacer" />
                <button disabled={busy} title="Rett opp hvis gjenkjenningen har bommet" onClick={() => run(async () => { await api.setApplianceOn(a.id, !a.on); onChange(); })}>
                  Merk som {a.on ? 'av' : 'på'}
                </button>
                <button className="icon" disabled={busy} aria-label={`Slett ${a.name}`} onClick={() => confirm(`Slette «${a.name}»?`) && run(async () => { await api.removeAppliance(a.id); onChange(); })}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && data.events.length > 0 && (
        <div className="status-group">
          <div className="small"><strong>Siste endringer i forbruket</strong></div>
          <div className="chips">
            {data.events.slice(0, 8).map((e) => (
              <span key={e.t} className="chip">
                {new Date(e.t).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })} {fmtDelta(e.delta)}
                <span className="muted"> · {e.match ?? 'ukjent'}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Kurve over husets forbruk med akser, grunnlast og markerte trinn. Tekst ligger i HTML over SVG-en
 * (SVG-en strekkes i bredden, så tekst inne i den ville blitt forvrengt).
 */
function PowerCurve({
  samples,
  startedAt,
  baseline,
  steps = [],
  marks = [],
}: {
  samples: PowerSample[];
  startedAt: number;
  baseline?: number | null;
  steps?: PowerStepRaw[];
  marks?: { sec: number; label: string; cls: string }[];
}) {
  if (samples.length < 2) return <div className="power-curve empty muted small">Venter på målinger fra Tibber Pulse…</div>;
  const W = 300;
  const H = 120;
  const t0 = startedAt;
  const t1 = Math.max(samples.at(-1)!.t, t0 + 60_000);
  const ws = samples.map((s) => s.w);
  const pad = Math.max(50, (Math.max(...ws) - Math.min(...ws)) * 0.15);
  const lo = Math.max(0, Math.min(...ws) - pad);
  const hi = Math.max(...ws) + pad;
  const xPct = (t: number) => ((t - t0) / (t1 - t0)) * 100;
  const yPct = (w: number) => 100 - ((w - lo) / (hi - lo)) * 100;
  const allMarks = [
    ...steps.map((s) => ({ sec: (s.t - t0) / 1000, label: fmtDelta(s.delta), cls: s.delta > 0 ? 'mark-on' : 'mark-off' })),
    ...marks,
  ];
  const last = samples.at(-1)!;
  return (
    <div className="power-curve">
      <span className="axis y-top">{fmtW(hi)}</span>
      <div className="plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Husets forbruk under identifiseringen">
          {baseline != null && <line className="baseline" x1={0} x2={W} y1={(yPct(baseline) * H) / 100} y2={(yPct(baseline) * H) / 100} />}
          {allMarks.map((m, i) => {
            const x = (xPct(t0 + m.sec * 1000) * W) / 100;
            return <line key={i} className={m.cls} x1={x} x2={x} y1={0} y2={H} />;
          })}
          <polyline points={samples.map((s) => `${((xPct(s.t) * W) / 100).toFixed(1)},${((yPct(s.w) * H) / 100).toFixed(1)}`).join(' ')} />
        </svg>
        {baseline != null && <span className="axis baseline-label" style={{ top: `${yPct(baseline)}%` }}>grunnlast {fmtW(baseline)}</span>}
        {allMarks.map((m, i) => (
          <span key={i} className={`mark-label ${m.cls}`} style={{ left: `${xPct(t0 + m.sec * 1000)}%` }}>{m.label}</span>
        ))}
        <span className="now-dot" style={{ left: `${xPct(last.t)}%`, top: `${yPct(last.w)}%` }} aria-hidden />
      </div>
      <div className="axis-row">
        <span className="axis">{fmtW(lo)}</span>
        <span className="axis">0 s – {Math.round((t1 - t0) / 1000)} s</span>
      </div>
    </div>
  );
}
