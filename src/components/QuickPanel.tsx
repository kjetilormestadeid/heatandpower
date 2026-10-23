import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Device, EaseeCharger, EaseeState, HueGroup, Room, TibberConsumption, TibberLive } from '../types';
import { MODE_LABEL, fmtTemp } from '../format';
import { dayCost } from '../pricing';
import { Icon } from './Icon';
import { easeeMode } from './EaseeSection';
import { CalendarTicker } from './CalendarDrawer';

type TempKey = 'roomComfortTemperature' | 'roomSleepTemperature' | 'roomAwayTemperature';

/** Hurtigpanel øverst for nettbrett: totalforbruk, og så elbil, lys og varme som én strøm av fliser. */
export function QuickPanel({
  houseId,
  rooms,
  independentCount,
  refreshKey,
  onRoomsChanged,
}: {
  houseId: string;
  rooms: Room[] | null;
  /** antall enheter uten rom – de hentes bare når det finnes noen */
  independentCount: number;
  refreshKey?: unknown;
  onRoomsChanged: () => void;
}) {
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
        {independentCount > 0 && <QuickDevices houseId={houseId} refreshKey={refreshKey} />}
      </div>
    </section>
  );
}

/** Tibber Pulse gir effekt nå og forbruk siden midnatt; uten Tibber vises Mill-ovnenes sum i dag.
 *  Kostnaden regnes selv med Norgespris + Elvia-nettleie (se pricing.ts), ikke Tibbers spotpris. */
function QuickEnergy({ rooms }: { rooms: Room[] | null }) {
  const [live, setLive] = useState<TibberLive | null>(null);
  const [hourly, setHourly] = useState<TibberConsumption[]>([]);

  // Timeforbruket fordeler dagens kWh på dag-/nattpris i nettleien
  useEffect(() => {
    let stop = false;
    const load = () =>
      api.tibberStatus()
        .then(async (s) => {
          if (!s.configured) return;
          const { homes } = await api.tibberHomes();
          const saved = localStorage.getItem('tibber.homeId');
          const id = homes.some((h) => h.id === saved) ? saved! : homes[0]?.id;
          if (!id) return;
          const o = await api.tibberOverview(id, 'HOURLY');
          if (!stop) setHourly(o.hourly?.nodes ?? []);
        })
        .catch(() => {});
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 5 * 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

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
  const cost = live ? costToday(live, hourly) : null;

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
          {cost && (
            <div className="quick-stat" title="Norgespris 50 øre + Tibber-påslag 3,40 øre og fastbeløp 49 kr/mnd + Elvia-nettleie (energiledd og fastledd 10–15 kW), inkl. mva og avgifter">
              <span className="muted small">Kostnad i dag</span>
              <strong>{num(cost.total, 0)} kr</strong>
              <span className="muted small">
                strøm {num(cost.energy, 0)} · nett {num(cost.grid, 0)} · faste {num(cost.fixed, 0)}
              </span>
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

/** Dagens kostnad: fullførte timer fra Tibber, resten av Pulse-forbruket på timen som går nå. */
function costToday(live: TibberLive, hourly: TibberConsumption[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const done = hourly
    .map((n) => ({ from: new Date(n.from), kwh: n.consumption ?? 0 }))
    .filter((h) => h.from >= today && h.from < now);
  const doneKwh = done.reduce((s, h) => s + h.kwh, 0);
  const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  const rest = Math.max(0, live.accumulatedConsumption - doneKwh);
  return dayCost(today, [...done, { from: hourStart, kwh: rest }]);
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
      t = window.setInterval(() => document.visibilityState === 'visible' && load(), 60_000);
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

/** Mill-enheter uten rom (f.eks. stikkontakter): trykk slår av/på, med effekt, temperatur og fukt. */
function QuickDevices({ houseId, refreshKey }: { houseId: string; refreshKey?: unknown }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => api.independentDevices(houseId).then((r) => (setDevices(r.items), setError(null)), (e) => setError(e.message)),
    [houseId],
  );

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 60_000); // Mill: maks 2500 kall/time
    return () => clearInterval(t);
  }, [load, refreshKey]);

  async function toggle(d: Device) {
    setBusyId(d.deviceId);
    setError(null);
    setDevices((list) => list?.map((x) => (x.deviceId === d.deviceId ? { ...x, isEnabled: !d.isEnabled } : x)) ?? null);
    try {
      await api.setDeviceEnabled(d.deviceId, !d.isEnabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke endre enheten');
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (!devices) return null;

  return (
    <>
      {error && <p className="error small quick-error">{error}</p>}
      {devices.map((d) => {
        const m = d.lastMetrics;
        const on = d.isConnected && d.isEnabled === true;
        const power = Math.round(m?.currentPower ?? 0);
        const canToggle = d.isEnabled != null && d.isConnected;
        return (
          <button
            key={d.deviceId}
            className={`quick-tile quick-device ${on ? 'on' : ''} ${d.isConnected ? '' : 'offline'}`}
            aria-pressed={d.isEnabled ?? undefined}
            disabled={!canToggle || busyId === d.deviceId}
            onClick={() => toggle(d)}
          >
            <span className="quick-head">
              <Icon name="plug" />
              <span className="quick-name">{d.customName?.trim() || d.deviceType.childType.name}</span>
            </span>
            <strong className="quick-value">
              {!d.isConnected ? 'Frakoblet' : d.isEnabled == null ? `${power} W` : on ? 'På' : 'Av'}
              {on && power > 0 && <span className="muted small">{power} W</span>}
            </strong>
            <span className="muted small">
              {m?.temperatureAmbient != null ? fmtTemp(m.temperatureAmbient) : d.deviceType.parentType.name}
              {/* Ovner melder fukt 0 – vis bare ekte målinger */}
              {(m?.humidity ?? 0) > 0 && ` · ${Math.round(m!.humidity!)} % fukt`}
            </span>
          </button>
        );
      })}
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
