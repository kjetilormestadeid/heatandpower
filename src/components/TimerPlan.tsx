import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { WEEKDAYS, type Device, type DeviceTimer, type TimerSetting, type Weekday } from '../types';

const DAY_SHORT: Record<Weekday, string> = {
  Monday: 'Man', Tuesday: 'Tir', Wednesday: 'Ons', Thursday: 'Tor', Friday: 'Fre', Saturday: 'Lør', Sunday: 'Søn',
};
const PRESETS: { label: string; days: Weekday[] }[] = [
  { label: 'Alle dager', days: [...WEEKDAYS] },
  { label: 'Hverdager', days: WEEKDAYS.slice(0, 5) },
  { label: 'Helg', days: WEEKDAYS.slice(5) },
];

const OFF_SETTINGS: TimerSetting[] = ['off', 'HARD_OFF', 'SOFT_OFF', 'turn_off_night_mode'];
const isOn = (s: TimerSetting) => !OFF_SETTINGS.includes(s);

// Ovner/stikkontakter bruker driftsmodus (normal/off/always_heating), luftrensere vifte-modus (TURN_ON/HARD_OFF …).
type Choice = { value: TimerSetting; label: string };
const HEATER_ON: Choice[] = [
  { value: 'always_heating', label: 'Alltid på' },
  { value: 'normal', label: 'Normal (følger termostat)' },
];
const HEATER_OFF: Choice[] = [{ value: 'off', label: 'Av' }];
const PURIFIER_ON: Choice[] = [
  { value: 'AUTO', label: 'Auto' },
  { value: 'TURN_ON', label: 'På' },
  { value: 'SLEEP', label: 'Natt' },
  { value: 'BOOST', label: 'Boost' },
];
const PURIFIER_OFF: Choice[] = [
  { value: 'SOFT_OFF', label: 'Av (sensorer aktive)' },
  { value: 'HARD_OFF', label: 'Helt av' },
];

function choicesFor(device: Device) {
  const purifier = device.deviceType.parentType.name === 'Air Purifiers';
  return purifier ? { on: PURIFIER_ON, off: PURIFIER_OFF } : { on: HEATER_ON, off: HEATER_OFF };
}

const DAY_MIN = 1440;
const toHHMM = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fromHHMM = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
const nextDay = (d: Weekday) => WEEKDAYS[(WEEKDAYS.indexOf(d) + 1) % 7];

export function TimerPlan({ device, onMoved }: { device: Device; onMoved: () => void }) {
  if (device.roomId) return <MakeIndependent device={device} onMoved={onMoved} />;
  return <TimerEditor device={device} />;
}

function MakeIndependent({ device, onMoved }: { device: Device; onMoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move() {
    const name = device.customName || device.deviceType.childType.name;
    if (!confirm(`Flytte «${name}» ut av rommet?

Enheten blir liggende i huset, men følger ikke lenger rommets program eller temperaturer. Du kan flytte den tilbake i Mill-appen.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.moveDevice(device.deviceId, device.houseId!);
      onMoved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke flytte enheten');
      setBusy(false);
    }
  }

  return (
    <div className="timer-plan">
      <p className="small" style={{ margin: 0 }}>
        Mill tillater bare egne tidsplaner for enheter som <strong>ikke ligger i et rom</strong>. Denne enheten følger nå
        rommets ukeprogram.
      </p>
      {error && <p className="error small">{error}</p>}
      <button className="primary" disabled={busy || !device.houseId} onClick={move}>
        {busy ? 'Flytter…' : 'Flytt ut av rommet og lag tidsplan'}
      </button>
    </div>
  );
}

function TimerEditor({ device }: { device: Device }) {
  const [timers, setTimers] = useState<DeviceTimer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [from, setFrom] = useState('06:00');
  const [to, setTo] = useState('08:00');
  const [days, setDays] = useState<Weekday[]>(WEEKDAYS.slice(0, 5));
  const choices = choicesFor(device);
  const [onSetting, setOnSetting] = useState<TimerSetting>(choices.on[0].value);
  const [offSetting, setOffSetting] = useState<TimerSetting>(choices.off[0].value);

  const load = useCallback(async () => {
    try {
      const r = await api.timers(device.deviceId);
      setTimers(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente timere');
    }
  }, [device.deviceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Noe gikk galt');
    } finally {
      setBusy(false);
    }
  }

  function addPeriod(e: FormEvent) {
    e.preventDefault();
    const start = fromHHMM(from);
    const end = fromHHMM(to);
    if (start === end) return setError('Fra og til kan ikke være like');
    if (days.length === 0) return setError('Velg minst én dag');
    const name = `${from}–${to}`;
    // Går perioden over midnatt, skal av-timeren trigge dagen etter.
    const offDays = end > start ? days : days.map(nextDay);
    run(async () => {
      const on = await api.createTimer(device.deviceId, { name: `På ${name}`, activationTime: start, repeatOn: days, setting: onSetting, isActive: true });
      try {
        await api.createTimer(device.deviceId, { name: `Av ${name}`, activationTime: end, repeatOn: offDays, setting: offSetting, isActive: true });
      } catch (err) {
        await api.deleteTimer(device.deviceId, on.id).catch(() => {});
        throw err;
      }
    });
  }

  function toggleDay(d: Weekday) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || cur.includes(x))));
  }

  const sorted = useMemo(
    () =>
      [...(timers ?? [])].sort(
        (a, b) => a.activationTime - b.activationTime || a.name.localeCompare(b.name),
      ),
    [timers],
  );

  return (
    <div className="timer-plan">
      {error && <p className="error small">{error}</p>}
      {!timers && !error && <p className="muted small">Henter tidsplan…</p>}

      {timers && <WeekView timers={timers} />}

      {timers && sorted.length > 0 && (
        <ul className="timers">
          {sorted.map((t) => (
            <li key={t.id} className={t.isActive ? '' : 'inactive'}>
              <span className="t-time">{toHHMM(t.activationTime)}</span>
              <span className={`pill ${isOn(t.setting) ? 'on' : ''}`} title={t.setting}>
                {isOn(t.setting) ? 'På' : 'Av'}
              </span>
              <span className="muted small t-days">
                {t.repeatOn?.length ? formatDays(t.repeatOn) : 'Én gang'}
              </span>
              <label className="switch sm" title={t.isActive ? 'Deaktiver' : 'Aktiver'}>
                <input
                  type="checkbox"
                  checked={t.isActive}
                  disabled={busy}
                  onChange={() => run(() => api.updateTimer(device.deviceId, t.id, { isActive: !t.isActive }))}
                />
                <span />
              </label>
              <button
                className="icon"
                aria-label={`Slett timer ${toHHMM(t.activationTime)}`}
                disabled={busy}
                onClick={() => run(() => api.deleteTimer(device.deviceId, t.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {timers && sorted.length === 0 && <p className="muted small">Ingen timere ennå.</p>}

      <form className="period-form" onSubmit={addPeriod}>
        <div className="period-row">
          <span className="muted small">På fra</span>
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} required />
          <span className="muted small">til</span>
          <input type="time" value={to} onChange={(e) => setTo(e.target.value)} required />
        </div>
        <div className="days">
          {WEEKDAYS.map((d) => (
            <button
              type="button"
              key={d}
              className={days.includes(d) ? 'selected' : ''}
              aria-pressed={days.includes(d)}
              onClick={() => toggleDay(d)}
            >
              {DAY_SHORT[d]}
            </button>
          ))}
        </div>
        <div className="presets">
          {PRESETS.map((p) => (
            <button type="button" className="link" key={p.label} onClick={() => setDays(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
        <details className="small">
          <summary className="muted">Avansert</summary>
          <div className="period-row">
            <label>
              På-modus{' '}
              <select value={onSetting} onChange={(e) => setOnSetting(e.target.value as TimerSetting)}>
                {choices.on.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            {choices.off.length > 1 && (
              <label>
                Av-modus{' '}
                <select value={offSetting} onChange={(e) => setOffSetting(e.target.value as TimerSetting)}>
                  {choices.off.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
            )}
          </div>
        </details>
        <button className="primary" disabled={busy}>
          {busy ? 'Lagrer…' : 'Legg til periode'}
        </button>
      </form>
    </div>
  );
}

function formatDays(days: Weekday[]) {
  const key = WEEKDAYS.filter((d) => days.includes(d)).join();
  const preset = PRESETS.find((p) => p.days.join() === key);
  return preset ? preset.label : WEEKDAYS.filter((d) => days.includes(d)).map((d) => DAY_SHORT[d]).join(' ');
}

/** Regner ut på-perioder over uka ut fra aktive, gjentakende timere. */
function onSegments(timers: DeviceTimer[]): [number, number][] {
  const events = timers
    .filter((t) => t.isActive && t.repeatOn?.length)
    .flatMap((t) =>
      t.repeatOn!.map((d) => ({ at: WEEKDAYS.indexOf(d) * DAY_MIN + t.activationTime, on: isOn(t.setting) })),
    )
    .sort((a, b) => a.at - b.at);
  if (events.length === 0) return [];

  const WEEK = 7 * DAY_MIN;
  const segs: [number, number][] = [];
  let state = events[events.length - 1].on; // tilstand ved inngangen til uka (fra forrige ukes siste hendelse)
  let since = 0;
  for (const ev of events) {
    if (ev.on !== state) {
      if (state) segs.push([since, ev.at]);
      state = ev.on;
      since = ev.at;
    }
  }
  if (state) segs.push([since, WEEK]);
  return segs;
}

function WeekView({ timers }: { timers: DeviceTimer[] }) {
  const segs = onSegments(timers);
  if (!timers.some((t) => t.isActive && t.repeatOn?.length)) return null;

  return (
    <div className="week" role="img" aria-label="Ukeoversikt over når enheten er på">
      {WEEKDAYS.map((d, i) => {
        const dayStart = i * DAY_MIN;
        const parts = segs
          .map(([a, b]) => [Math.max(a, dayStart), Math.min(b, dayStart + DAY_MIN)] as const)
          .filter(([a, b]) => b > a);
        return (
          <div className="week-row" key={d}>
            <span className="muted small">{DAY_SHORT[d]}</span>
            <div className="track">
              {parts.map(([a, b]) => (
                <div
                  key={a}
                  className="seg-on"
                  style={{ left: `${((a - dayStart) / DAY_MIN) * 100}%`, width: `${((b - a) / DAY_MIN) * 100}%` }}
                  title={`På ${toHHMM(a - dayStart)}–${toHHMM(b - dayStart)}`}
                />
              ))}
            </div>
          </div>
        );
      })}
      <div className="week-row">
        <span />
        <div className="hours muted small">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
        </div>
      </div>
    </div>
  );
}
