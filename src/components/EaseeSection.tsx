import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { EaseeCharger, EaseeChargerData, EaseeCommand } from '../types';
import { BarChart } from './BarChart';
import { Icon } from './Icon';
import { pollWithBackoff } from '../useServicePoll';

const POLL_MS = 30_000;

type Tone = 'on' | 'heat' | 'warn' | '';
const OP_MODE: Record<number, { label: string; tone: Tone }> = {
  0: { label: 'Frakoblet', tone: 'warn' },
  1: { label: 'Ingen bil tilkoblet', tone: '' },
  2: { label: 'Venter på start', tone: 'warn' },
  3: { label: 'Lader', tone: 'on' },
  4: { label: 'Ferdig ladet', tone: '' },
  5: { label: 'Feil', tone: 'heat' },
  6: { label: 'Klar til lading', tone: '' },
  7: { label: 'Venter på godkjenning', tone: 'warn' },
  8: { label: 'Avslutter', tone: '' },
};
export const easeeMode = (mode: number) => OP_MODE[mode] ?? { label: `Ukjent (${mode})`, tone: '' as Tone };

const kw = (v: number) => `${v.toLocaleString('nb-NO', { maximumFractionDigits: 1 })} kW`;
const kwh = (v: number) => `${v.toLocaleString('nb-NO', { maximumFractionDigits: 1 })} kWh`;

/** Easee-ladere på kontoen: status, effekt nå, energi i økten, dagens forbruk per time og styring. */
export function EaseeSection() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [chargers, setChargers] = useState<EaseeCharger[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Laderlisten endrer seg sjelden; feiler den (f.eks. Easee nede ved oppstart) prøves det igjen med økende pause
  useEffect(
    () =>
      pollWithBackoff(async () => {
        try {
          const s = await api.easeeStatus();
          setConfigured(s.configured);
          if (s.configured) setChargers((await api.easeeChargers()).chargers);
          setError(null);
          return true;
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Fikk ikke kontakt med Easee');
          return false;
        }
      }, 10 * 60_000),
    [],
  );

  if (configured === null && !error) return null;

  if (configured === false) {
    return (
      <section className="card energy">
        <h2>Elbillading (Easee)</h2>
        <p className="small" style={{ margin: 0 }}>
          Legg inn Easee-innloggingen i <code>.env</code> som <code>EASEE_USERNAME=…</code> og <code>EASEE_PASSWORD=…</code>,
          så vises laderen her.
        </p>
      </section>
    );
  }

  return (
    <section className="card energy">
      <div className="section-head">
        <h2>Elbillading (Easee)</h2>
      </div>
      {error && <p className="error small">{error}</p>}
      {!chargers && !error && <p className="muted small">Henter ladere…</p>}
      {chargers?.length === 0 && <p className="muted small">Ingen ladere på denne Easee-kontoen.</p>}
      {chargers?.map((c) => <ChargerPanel key={c.id} charger={c} showName={chargers.length > 1} />)}
    </section>
  );
}

function ChargerPanel({ charger, showName }: { charger: EaseeCharger; showName: boolean }) {
  const [data, setData] = useState<EaseeChargerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api.easeeCharger(charger.id).then(
        (d) => (setData(d), setError(null), true),
        (e) => (setError(e.message), false),
      ),
    [charger.id],
  );

  // Siste status blir stående ved feil; nye forsøk trappes ned til Easee svarer igjen
  useEffect(() => pollWithBackoff(load, POLL_MS), [load]);

  async function command(cmd: EaseeCommand) {
    setBusy(true);
    setError(null);
    try {
      await api.easeeCommand(charger.id, cmd);
      // Laderen bruker noen sekunder på å endre status
      setTimeout(load, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kommandoen feilet');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="charger">
      {showName && <h3>{charger.name || charger.id}</h3>}
      {error && <p className="error small">{error}</p>}
      {!data && !error && <p className="muted small">Henter status…</p>}
      {data && <ChargerView data={data} name={showName ? undefined : (charger.name ?? undefined)} busy={busy} onCommand={command} />}
    </div>
  );
}

/** Ren visning av én lader (ingen henting). */
export function ChargerView({
  data,
  name,
  busy,
  onCommand,
}: {
  data: EaseeChargerData;
  name?: string;
  busy?: boolean;
  onCommand?: (cmd: EaseeCommand) => void;
}) {
  const { state, hourly } = data;
  const mode = easeeMode(state.isOnline ? state.chargerOpMode : 0);
  const charging = state.chargerOpMode === 3;
  const carConnected = [2, 3, 4, 6, 7].includes(state.chargerOpMode);
  const today = hourly.reduce((s, h) => s + h.totalEnergy, 0);
  // Alltid hele døgnet 00–23, også når Easee bare har data for noen timer
  const byHour = new Map(hourly.map((h) => [new Date(h.from).getHours(), h.totalEnergy]));

  return (
    <>
      <div className="charger-head">
        <span className={`pill ${mode.tone}`}>{charging && <Icon name="bolt" />} {mode.label}</span>
        {name && <span className="muted small">{name}</span>}
      </div>
      <div className="tiles">
        <div className="tile">
          <span className="muted small">Effekt nå</span>
          <strong className={charging ? 'now-total' : ''}>{kw(charging ? state.totalPower : 0)}</strong>
        </div>
        {/* Easee oppdaterer øktenergien sjelden – skjul 0 i stedet for å vise noe misvisende */}
        {state.sessionEnergy > 0 && (
          <div className="tile">
            <span className="muted small">{charging ? 'Ladet i denne økten' : 'Siste økt'}</span>
            <strong>{kwh(state.sessionEnergy)}</strong>
          </div>
        )}
        <div className="tile">
          <span className="muted small">Ladet i dag</span>
          <strong>{kwh(today)}</strong>
        </div>
        {charging && state.outputCurrent != null && (
          <div className="tile">
            <span className="muted small">Strøm til bilen</span>
            <strong>{Math.round(state.outputCurrent)} A</strong>
          </div>
        )}
      </div>

      {onCommand && state.isOnline && carConnected && (
        <div className="charger-actions">
          {charging && <button disabled={busy} onClick={() => onCommand('pause')}>Pause</button>}
          {(state.chargerOpMode === 2 || state.chargerOpMode === 6) && (
            <button className="primary" disabled={busy} onClick={() => onCommand('resume')}>Start lading</button>
          )}
          {state.chargerOpMode === 7 && (
            <button className="primary" disabled={busy} onClick={() => onCommand('start')}>Godkjenn og start</button>
          )}
          {charging && <button disabled={busy} onClick={() => onCommand('stop')}>Stopp</button>}
        </div>
      )}

      {today > 0 && (
        <BarChart
          label="Lading per time i dag"
          unit="kWh"
          formatAxis={(v) => v.toLocaleString('nb-NO', { maximumFractionDigits: 1 })}
          bars={Array.from({ length: 24 }, (_, hour) => {
            const value = byHour.get(hour) ?? 0;
            return {
              key: String(hour),
              value,
              tick: hour % 3 === 0 ? String(hour).padStart(2, '0') : undefined,
              tooltip: (
                <>
                  <div className="muted small">kl. {String(hour).padStart(2, '0')}:00</div>
                  <strong>{kwh(value)}</strong>
                </>
              ),
            };
          })}
        />
      )}
    </>
  );
}
