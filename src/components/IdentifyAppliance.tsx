import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import type { AppliancesResponse, IdentifyAnalysis, PowerSample } from '../types';

const fmtW = (w: number) => (w >= 1000 ? `${(w / 1000).toLocaleString('nb-NO', { maximumFractionDigits: 2 })} kW` : `${Math.round(w)} W`);
const time = (iso: string) => new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
/** Nok tid til å slå på, vente og slå av igjen */
const MIN_RECORD_S = 40;

type Phase =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'analyzing' }
  | { kind: 'result'; analysis: IdentifyAnalysis; samples: PowerSample[]; startedAt: number };

/**
 * Identifiser-modus: brukeren slår et apparat på og av mens Tibber Pulse måler hele huset.
 * Forbruket analyseres (OpenAI eller lokalt), og apparatet lagres med navn og effekt.
 */
export function IdentifyAppliance({ data, onChange }: { data: AppliancesResponse | null; onChange: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [samples, setSamples] = useState<PowerSample[]>([]);
  const [now, setNow] = useState(Date.now());
  const [name, setName] = useState('');
  const [watts, setWatts] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (phase.kind !== 'recording') return;
    const poll = () => {
      setNow(Date.now());
      api.identifySamples().then((r) => setSamples(r.samples), () => {});
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
      setPhase({ kind: 'recording', startedAt: new Date(r.startedAt).getTime() });
    });

  const analyze = (recording: Phase) =>
    run(async () => {
      setPhase({ kind: 'analyzing' });
      try {
        const r = await api.identifyAnalyze();
        setWatts(r.analysis.watts != null ? String(r.analysis.watts) : '');
        setName('');
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
      setPhase({ kind: 'idle' });
      onChange();
    });

  const elapsed = phase.kind === 'recording' ? Math.max(0, Math.round((now - phase.startedAt) / 1000)) : 0;
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
            Slå et apparat <strong>på</strong>, vent et halvt minutt, slå det <strong>av</strong> igjen. Tibber Pulse måler hele huset, og
            endringen viser hvor mye apparatet trekker. Unngå å bruke andre store ting samtidig.
          </p>
          <button className="primary" disabled={busy} onClick={start}>Start identifisering</button>
        </>
      )}

      {phase.kind === 'recording' && (
        <>
          <ol className="identify-steps small">
            <li className={elapsed >= 10 ? 'done' : ''}>Vent noen sekunder (måler grunnlast)</li>
            <li>Slå apparatet <strong>på</strong> og la det stå i ca. 30 sekunder</li>
            <li>Slå det <strong>av</strong>, vent 20 sekunder og trykk «Analyser»</li>
          </ol>
          <div className="tiles">
            <div className="tile">
              <span className="muted small">Hele huset nå</span>
              <strong className="now-total">{current != null ? fmtW(current) : '–'}</strong>
            </div>
            <div className="tile">
              <span className="muted small">Tid</span>
              <strong>{elapsed} s</strong>
            </div>
          </div>
          <PowerCurve samples={samples} startedAt={phase.startedAt} />
          <div className="period-row">
            <button className="primary" disabled={busy || elapsed < MIN_RECORD_S} onClick={() => analyze(phase)}>
              Analyser{elapsed < MIN_RECORD_S ? ` (om ${MIN_RECORD_S - elapsed} s)` : ''}
            </button>
            <button disabled={busy} onClick={cancel}>Avbryt</button>
          </div>
        </>
      )}

      {phase.kind === 'analyzing' && <p className="muted small">Analyserer forbruket…</p>}

      {phase.kind === 'result' && (
        <>
          <p className="small" style={{ margin: 0 }}>
            {phase.analysis.found ? (
              <>Fant et apparat på <strong>{fmtW(phase.analysis.watts ?? 0)}</strong> · sikkerhet {phase.analysis.confidence}. </>
            ) : (
              <strong>Fant ikke noe tydelig apparat. </strong>
            )}
            <span className="muted">{phase.analysis.explanation}</span>
          </p>
          <PowerCurve samples={phase.samples} startedAt={phase.startedAt} onAtSec={phase.analysis.onAtSec} offAtSec={phase.analysis.offAtSec} />
          <form
            className="period-row"
            onSubmit={(e) => {
              e.preventDefault();
              const edited = Number(watts) !== phase.analysis.watts;
              save(edited ? 'manual' : phase.analysis.source);
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hva var det? F.eks. Varmekabler bad" aria-label="Navn" autoFocus />
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
                {new Date(e.t).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })} {e.delta > 0 ? '+' : '−'}{fmtW(Math.abs(e.delta))}
                <span className="muted"> · {e.match ?? 'ukjent'}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Enkel kurve over husets forbruk, med markering av på/av fra analysen. */
function PowerCurve({ samples, startedAt, onAtSec, offAtSec }: { samples: PowerSample[]; startedAt: number; onAtSec?: number | null; offAtSec?: number | null }) {
  if (samples.length < 2) return <div className="power-curve muted small">Venter på målinger fra Tibber Pulse…</div>;
  const W = 300;
  const H = 80;
  const t0 = startedAt;
  const t1 = Math.max(samples.at(-1)!.t, t0 + 60_000);
  const ws = samples.map((s) => s.w);
  const lo = Math.min(...ws) * 0.95;
  const hi = Math.max(...ws) * 1.05 || 1;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (w: number) => H - ((w - lo) / (hi - lo || 1)) * H;
  const mark = (sec: number | null | undefined, cls: string) =>
    sec != null && <line className={cls} x1={x(t0 + sec * 1000)} x2={x(t0 + sec * 1000)} y1={0} y2={H} />;
  return (
    <svg className="power-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Husets forbruk under identifiseringen">
      <polyline points={samples.map((s) => `${x(s.t).toFixed(1)},${y(s.w).toFixed(1)}`).join(' ')} />
      {mark(onAtSec, 'mark-on')}
      {mark(offAtSec, 'mark-off')}
    </svg>
  );
}
