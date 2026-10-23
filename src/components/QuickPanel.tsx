import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { EaseeCharger, EaseeState, HueGroup, Room, TibberLive } from '../types';
import { MODE_LABEL, fmtTemp } from '../format';
import { Icon } from './Icon';
import { easeeMode } from './EaseeSection';
import { CalendarTicker } from './CalendarDrawer';

type TempKey = 'roomComfortTemperature' | 'roomSleepTemperature' | 'roomAwayTemperature';

/** Hurtigpanel øverst for nettbrett: totalforbruk, og så elbil, lys og varme som én strøm av fliser. */
export function QuickPanel({ rooms, onRoomsChanged }: { rooms: Room[] | null; onRoomsChanged: () => void }) {
  return (
    <section className="card quick">
      <div className="quick-top">
        <QuickEnergy rooms={rooms} />
        <CalendarTicker />
      </div>
      <div className="quick-grid">
        <QuickCharging />
        <QuickLights />
        {rooms?.map((r) => (
          <HeatTile key={r.id} room={r} onChanged={onRoomsChanged} />
        ))}
      </div>
    </section>
  );
}

/** Tibber Pulse gir effekt nå og forbruk siden midnatt; uten Tibber vises Mill-ovnenes sum i dag. */
function QuickEnergy({ rooms }: { rooms: Room[] | null }) {
  const [live, setLive] = useState<TibberLive | null>(null);

  useEffect(() => {
    let stop = false;
    const poll = () =>
      document.visibilityState === 'visible' &&
      api.tibberStatus()
        .then((s) => (s.configured ? api.tibberLive() : { live: null, error: null }))
        .then((r) => !stop && setLive(r.live), () => {});
    poll();
    const t = setInterval(poll, 10_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const millWh = rooms?.reduce((s, r) => s + r.roomEnergyUsage, 0) ?? 0;
  const num = (v: number, digits: number) => v.toLocaleString('nb-NO', { maximumFractionDigits: digits });

  return (
    <div className="quick-energy">
      {live ? (
        <>
          <div className="quick-stat">
            <span className="muted small">Forbruk nå</span>
            <strong>{live.power >= 1000 ? `${num(live.power / 1000, 1)} kW` : `${num(live.power, 0)} W`}</strong>
          </div>
          <div className="quick-stat">
            <span className="muted small">Totalt i dag</span>
            <strong>{num(live.accumulatedConsumption, 1)} kWh</strong>
          </div>
          {live.accumulatedCost != null && (
            <div className="quick-stat">
              <span className="muted small">Kostnad i dag</span>
              <strong>{num(live.accumulatedCost, 0)} kr</strong>
            </div>
          )}
        </>
      ) : (
        rooms && (
          <div className="quick-stat">
            <span className="muted small">Mill-ovner i dag</span>
            <strong>{num(millWh / 1000, 1)} kWh</strong>
          </div>
        )
      )}
    </div>
  );
}

/** Om elbilene lader nå: status, effekt og energi i økten per Easee-lader. Vises bare når Easee er satt opp. */
function QuickCharging() {
  const [chargers, setChargers] = useState<{ charger: EaseeCharger; state: EaseeState | null }[] | null>(null);

  useEffect(() => {
    let stop = false;
    let t: number | undefined;
    api.easeeStatus().then(async (s) => {
      if (!s.configured) return;
      const { chargers: list } = await api.easeeChargers();
      const load = () =>
        Promise.all(
          list.map((c) => api.easeeCharger(c.id).then((d) => ({ charger: c, state: d.state }), () => ({ charger: c, state: null }))),
        ).then((r) => !stop && setChargers(r));
      load();
      t = window.setInterval(() => document.visibilityState === 'visible' && load(), 30_000);
    }).catch(() => {});
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, []);

  if (!chargers?.length) return null;
  const num = (v: number) => v.toLocaleString('nb-NO', { maximumFractionDigits: 1 });

  return chargers.map(({ charger, state }) => {
    const charging = state?.chargerOpMode === 3;
    return (
      <div key={charger.id} className={`quick-tile quick-ev ${charging ? 'charging' : ''}`}>
        <div className="quick-head">
          <Icon name="bolt" />
          <span className="quick-name">{charger.name || 'Elbil'}</span>
        </div>
        <strong className="quick-value">{state ? (charging ? `${num(state.totalPower)} kW` : easeeMode(state.chargerOpMode).label) : 'Utilgjengelig'}</strong>
        <span className="muted small">
          {charging ? 'Lader nå' : 'Lader ikke'}
          {state && state.sessionEnergy > 0 ? ` · ${num(state.sessionEnergy)} kWh` : ''}
        </span>
      </div>
    );
  });
}

/** Av/på-fliser per Hue-rom, pluss en flis som slår av alt. Vises bare når Hue er koblet til. */
function QuickLights() {
  const [groups, setGroups] = useState<HueGroup[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.hueGroups().then((g) => (setGroups(g.groups), setError(null)), (e) => setError(e.message)), []);

  useEffect(() => {
    let t: number | undefined;
    api.hueStatus().then((s) => {
      if (!s.connected) return;
      load();
      t = window.setInterval(() => document.visibilityState === 'visible' && load(), 30_000);
    }, () => {});
    return () => window.clearInterval(t);
  }, [load]);

  async function toggle(g: HueGroup, on: boolean) {
    setBusyId(g.id);
    setGroups((list) => list?.map((x) => (x.id === g.id || g.kind === 'home' ? { ...x, on } : x)) ?? null);
    try {
      await api.hueSetGroup(g.id, on);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke endre lysene');
    } finally {
      await load();
      setBusyId(null);
    }
  }

  if (!groups) return null;
  const home = groups.find((g) => g.kind === 'home');
  const roomGroups = groups.filter((g) => g.kind === 'room');

  return (
    <>
      {error && <p className="error small quick-error">{error}</p>}
      {roomGroups.map((g) => (
        <button
          key={g.id}
          className={`quick-tile quick-light ${g.on ? 'on' : ''}`}
          aria-pressed={g.on}
          disabled={busyId === g.id}
          onClick={() => toggle(g, !g.on)}
        >
          <span className="quick-head">
            <Icon name="bulb" />
            <span className="quick-name">{g.name}</span>
          </span>
          <strong className="quick-value">{g.on ? 'På' : 'Av'}</strong>
          <span className="small">{g.on && g.brightness != null ? `${g.brightness} %` : 'Lys'}</span>
        </button>
      ))}
      {home && (
        <button
          className="quick-tile quick-all"
          disabled={busyId === home.id || !roomGroups.some((g) => g.on)}
          onClick={() => toggle(home, false)}
        >
          <span className="quick-head">
            <Icon name="bulb" />
            <span className="quick-name">Alt lys</span>
          </span>
          <strong className="quick-value">Slå av</strong>
        </button>
      )}
    </>
  );
}

/** Rommets temperatur og luftfuktighet nå, og settpunktet for modusen som gjelder akkurat nå, med −/+ knapper. */
function HeatTile({ room, onChanged }: { room: Room; onChanged: () => void }) {
  const effective = room.mode === 'weekly_program' ? room.activeModeFromWeeklyProgram : room.mode;
  const key: TempKey = effective === 'sleep' ? 'roomSleepTemperature' : effective === 'away' ? 'roomAwayTemperature' : 'roomComfortTemperature';
  const [target, setTarget] = useState<number | null>(room[key]);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // Synk fra server når vi ikke har ulagrede endringer
  useEffect(() => {
    if (!pending.current) setTarget(room[key]);
  }, [room, key]);

  const maxTemp = room.roomMaxTemperature ? Number(room.roomMaxTemperature) : 35;
  const canChange = room.changeTemperature && target != null && effective !== 'off';

  function adjust(delta: number) {
    if (target == null) return;
    const next = Math.min(maxTemp, Math.max(5, Math.round((target + delta) * 2) / 2));
    setTarget(next);
    pending.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        await api.setRoomTemperature(room.id, { [key]: next });
        setError(false);
      } catch {
        setError(true);
      } finally {
        pending.current = false;
        onChanged();
      }
    }, 800);
  }

  return (
    <div className={`quick-tile quick-heat ${room.roomHeatStatus ? 'heating' : ''} ${room.isRoomOnline ? '' : 'offline'}`}>
      <div className="quick-head">
        <Icon name={room.roomHeatStatus ? 'flame' : 'thermometer'} />
        <span className="quick-name">{room.name}</span>
      </div>
      <strong className="quick-value">
        {fmtTemp(room.averageTemperature)}
        {room.roomHumidity != null && (
          <span className="quick-humidity muted small" title="Luftfuktighet">
            <Icon name="droplet" /> {Math.round(room.roomHumidity)} %
          </span>
        )}
      </strong>
      <span className="muted small">
        {MODE_LABEL[effective ?? 'weekly_program']}
        {target != null && effective !== 'off' ? ` · mål ${fmtTemp(target)}` : ''}
      </span>
      <div className="quick-heat-btns">
        <button aria-label={`Senk temperaturen i ${room.name}`} disabled={!canChange} onClick={() => adjust(-0.5)}>
          <Icon name="minus" />
        </button>
        <button aria-label={`Øk temperaturen i ${room.name}`} disabled={!canChange} onClick={() => adjust(0.5)}>
          <Icon name="plus" />
        </button>
      </div>
      {error && <span className="error small">Kunne ikke lagre</span>}
    </div>
  );
}
