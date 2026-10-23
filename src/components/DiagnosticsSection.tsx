import { useState } from 'react';
import { api } from '../api';
import type { MillDiag, MillNetworkDiagnostics } from '../types';

const VERDICT: Record<MillDiag['verdict'], { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  ok: { label: 'OK', tone: 'ok' },
  unknown: { label: 'Usikker', tone: 'warn' },
  cloud: { label: 'Ikke i Mill-skyen', tone: 'bad' },
  nowifi: { label: 'Ikke på wifi', tone: 'bad' },
  offline: { label: 'Frakoblet', tone: 'bad' },
};

const gen = (model: string) => (/G2/.test(model) ? 'Gen 2' : /G3/.test(model) ? 'Gen 3' : /G4/.test(model) ? 'Gen 4' : null);

/** Feilsøking av Mill-ovner og wifi: kjøres på knappetrykk (Deco-innlogging er treg). */
export function DiagnosticsSection() {
  const [data, setData] = useState<MillNetworkDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setData(await api.millNetworkDiagnostics());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Feilsøkingen feilet');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card energy">
      <div className="section-head">
        <h2>Feilsøking: Mill og wifi</h2>
        <div className="spacer" />
        {open && (
          <button className="primary" disabled={busy} onClick={run}>
            {busy ? 'Sjekker… (Deco kan bruke 30 s)' : data ? 'Kjør på nytt' : 'Kjør sjekk'}
          </button>
        )}
        <button className="link small" onClick={() => setOpen((o) => !o)}>{open ? 'Skjul' : 'Vis'}</button>
      </div>
      {open && (
        <>
          {!data && !busy && (
            <p className="muted small" style={{ margin: 0 }}>
              Sammenligner Mill-enhetene med det Deco ser på wifi, og leter etter ovner som er på nettet men ikke i Mill-appen.
            </p>
          )}
          {error && <p className="error small">{error}</p>}
          {data && <DiagnosticsView data={data} />}
          <Gen2Checklist />
        </>
      )}
    </section>
  );
}

/** Ren visning av feilsøkingsresultatet. */
export function DiagnosticsView({ data }: { data: MillNetworkDiagnostics }) {
  const problems = data.devices.filter((d) => VERDICT[d.verdict].tone === 'bad');
  const offlineDecos = data.deco?.units.filter((u) => !u.online) ?? [];
  return (
    <>
      <div className="tiles">
        <div className="tile">
          <span className="muted small">Mill-enheter</span>
          <strong>{data.devices.length}</strong>
        </div>
        <div className="tile">
          <span className="muted small">Med problemer</span>
          <strong className={problems.length ? 'diag-bad' : ''}>{problems.length}</strong>
        </div>
        <div className="tile">
          <span className="muted small">Ukjente kandidater</span>
          <strong className={data.candidates.length ? 'diag-warn' : ''}>{data.candidates.length}</strong>
        </div>
        {data.deco && (
          <div className="tile">
            <span className="muted small">Deco på nett</span>
            <strong className={offlineDecos.length ? 'diag-warn' : ''}>
              {data.deco.units.length - offlineDecos.length} av {data.deco.units.length}
            </strong>
          </div>
        )}
      </div>
      {data.decoError && <p className="error small">Deco: {data.decoError} – wifi-sjekken er hoppet over.</p>}

      <ul className="diag-list">
        {data.devices.map((d) => {
          const v = VERDICT[d.verdict];
          const g = gen(d.model);
          return (
            <li key={d.id}>
              <span className={`dot ${v.tone === 'ok' ? 'on' : 'off'} diag-${v.tone}`} aria-hidden />
              <div className="diag-main">
                <div className="diag-title">
                  <strong>{d.name}</strong>
                  {g && <span className="pill">{g}</span>}
                  <span className="muted small">{d.room}</span>
                </div>
                <span className="muted small">{d.hint}</span>
              </div>
              <div className="diag-net small">
                <span className={`pill ${v.tone === 'ok' ? '' : v.tone === 'warn' ? 'warn' : 'heat'}`}>{v.label}</span>
                <span className="muted">
                  Mill {d.millConnected ? 'tilkoblet' : 'frakoblet'}
                  {d.wifi ? ` · ${d.wifi.ip ?? '?'}${d.wifi.band ? ` · ${d.wifi.band} GHz` : ''}${d.wifi.guest ? ' · gjestenett' : ''}` : ''}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {data.candidates.length > 0 && (
        <div className="status-group">
          <div className="small"><strong>På nettet, men ikke i Mill-appen</strong></div>
          <ul className="diag-list">
            {data.candidates.map((c) => (
              <li key={c.mac}>
                <span className="dot off diag-warn" aria-hidden />
                <div className="diag-main">
                  <div className="diag-title">
                    <strong>{c.name}</strong>
                    <span className="muted small">{c.ip}{c.band ? ` · ${c.band} GHz` : ''} · {c.mac}</span>
                  </div>
                  <span className="muted small">{c.reason}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.deco && (
        <details>
          <summary className="small">Deco-enheter ({data.deco.units.length}) · {data.deco.clients} enheter på nettet</summary>
          <ul className="chips" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {data.deco.units.map((u) => (
              <li key={u.mac} className="chip" title={u.firmware ?? undefined}>
                <span className={u.online ? '' : 'diag-bad'}>{u.name}</span>
                <span className="muted"> · {u.model ?? '?'}{u.role === 'master' ? ' · hoved' : ''}{u.online ? (u.firmware ? ` · ${u.firmware.split(' ')[0]}` : '') : ' · AV'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        Sjekket {new Date(data.checkedAt).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </>
  );
}

function Gen2Checklist() {
  return (
    <details className="gen2">
      <summary className="small"><strong>Sjekkliste: koble til Gen 2-panelovn</strong></summary>
      <ol className="small">
        <li>Ovnen må på <strong>2,4 GHz</strong>. Deco X60 blander 2,4 og 5 GHz – bruk IoT-nettverk (nyere fastvare) eller et <strong>gjestenett med bare 2,4 GHz</strong>.</li>
        <li>Sikkerhet <strong>WPA2</strong> (ikke WPA3/blandet). Nettverksnavn og passord uten æ/ø/å og spesialtegn.</li>
        <li>Stå nær en Deco som er <strong>på nett</strong> – sjekk listen over Deco-enheter over.</li>
        <li>Tilbakestill ovnen til fabrikkinnstillinger før ny paring, ellers prøver den det gamle nettet.</li>
        <li>I Mill-appen: legg til enhet → panelovn → <strong>Generasjon 2</strong>, og koble telefonen til ovnens eget oppsettsnett når appen ber om det.</li>
        <li>Etterpå: kjør sjekken her – ovnen skal stå som «OK». Gen 2 melder en annen MAC til Mill enn wifi-modulen bruker, så den kan dukke opp som «HF-LPT230» på nettet.</li>
      </ol>
    </details>
  );
}
