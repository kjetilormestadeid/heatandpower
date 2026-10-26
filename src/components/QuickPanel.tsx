import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Device, EaseeCharger, EaseeState, HueGroup, Room, SonosOverview, TibberConsumption, TibberLive } from '../types';
import { MODE_LABEL, fmtTemp } from '../format';
import { dayCost } from '../pricing';
import { Icon } from './Icon';
import { easeeMode } from './EaseeSection';
import { CalendarTicker } from './CalendarDrawer';
import { OFF, useServicePoll } from '../useServicePoll';

type TempKey = 'roomComfortTemperature' | 'roomSleepTemperature' | 'roomAwayTemperature';

/** Hurtigpanel øverst for nettbrett: totalforbruk, og så elbil, lys og varme som én strøm av fliser. */
export function QuickPanel({
  houseId,
  rooms,
  independentCount,
  refreshKey,
  roomsDown = false,
  onRoomsChanged,
}: {
  houseId: string;
  rooms: Room[] | null;
  /** siste henting av rom feilet – varmeflisene viser sist kjente verdier */
  roomsDown?: boolean;
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
        <QuickSonos />
        {rooms?.map((r) => (
          <HeatTile key={r.id} room={r} stale={roomsDown} onChanged={onRoomsChanged} />
        ))}
        {independentCount > 0 && <QuickDevices houseId={houseId} refreshKey={refreshKey} />}
      </div>
    </section>
  );
}

/** Tibber Pulse gir effekt nå og forbruk siden midnatt; uten Tibber vises Mill-ovnenes sum i dag.
 *  Kostnaden regnes selv med Norgespris + Elvia-nettleie (se pricing.ts), ikke Tibbers spotpris. */
function QuickEnergy({ rooms }: { rooms: Room[] | null }) {
  // Pulse: uten fersk måling regnes Tibber som nede, og siste måling vises dempet
  const { data: live, down } = useServicePoll<TibberLive>(
    async () => {
      if (!(await api.tibberStatus()).configured) return OFF;
      const r = await api.tibberLive();
      if (!r.live) throw new Error(r.error ?? 'Ingen måling fra Tibber Pulse');
      return r.live;
    },
    10_000,
    [],
  );
  // Timeforbruket fordeler dagens kWh på dag-/nattpris i nettleien
  const { data: hourly } = useServicePoll<TibberConsumption[]>(
    async () => {
      if (!(await api.tibberStatus()).configured) return OFF;
      const { homes } = await api.tibberHomes();
      const saved = localStorage.getItem('tibber.homeId');
      const id = homes.some((h) => h.id === saved) ? saved! : homes[0]?.id;
      if (!id) return OFF;
      return (await api.tibberOverview(id, 'HOURLY')).hourly?.nodes ?? [];
    },
    5 * 60_000,
    [],
  );

  const millWh = rooms?.reduce((s, r) => s + r.roomEnergyUsage, 0) ?? 0;
  const num = (v: number, digits: number) => v.toLocaleString('nb-NO', { maximumFractionDigits: digits });
  const cost = live ? costToday(live, hourly ?? []) : null;

  return (
    <div className={`quick-energy ${live && down ? 'stale' : ''}`}>
      {live && down && <Stale />}
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
  const { data: chargers, down } = useServicePoll<{ charger: EaseeCharger; state: EaseeState | null; stale: boolean }[]>(
    async (prev) => {
      if (!(await api.easeeStatus()).configured) return OFF;
      const { chargers: list } = await api.easeeChargers();
      // En lader som ikke svarer beholder forrige status, merket som utdatert
      return Promise.all(
        list.map((c) =>
          api.easeeCharger(c.id).then(
            (d) => ({ charger: c, state: d.state, stale: false }),
            () => ({ charger: c, state: prev?.find((p) => p.charger.id === c.id)?.state ?? null, stale: true }),
          ),
        ),
      );
    },
    30_000,
    [],
  );

  if (!chargers?.length) return null;
  const num = (v: number) => v.toLocaleString('nb-NO', { maximumFractionDigits: 1 });

  return chargers.map(({ charger, state, stale }) => {
    const charging = state?.chargerOpMode === 3;
    const isStale = down || stale;
    return (
      <div key={charger.id} className={`quick-tile quick-ev ${charging ? 'charging' : ''} ${isStale ? 'stale' : ''}`}>
        {isStale && <Stale />}
        <div className="quick-head">
          <Icon name="bolt" />
          <span className="quick-name">{charger.name || 'Elbil'}</span>
        </div>
        <strong className="quick-value">{state ? (charging ? `${num(state.totalPower)} kW` : easeeMode(state.chargerOpMode).label) : '–'}</strong>
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data: groups, down, burst } = useServicePoll<HueGroup[]>(
    async () => ((await api.hueStatus()).connected ? (await api.hueGroups()).groups : OFF),
    60_000,
    [],
  );
  const { expect, shown, pending } = useExpected<boolean>((id) => groups?.find((g) => g.id === id)?.on);

  async function toggle(g: HueGroup, on: boolean) {
    setBusyId(g.id);
    // «Slå av alt» gjelder alle rommene
    for (const x of g.kind === 'home' ? (groups ?? []).filter((x) => x.kind === 'room' && x.on) : [g]) expect(x.id, on);
    // Feiler det, viser de tette hentingene riktig status – eller merker flisene som uten kontakt
    await api.hueSetGroup(g.id, on).catch(() => {});
    setBusyId(null);
    burst();
  }

  if (!groups) return null;
  const home = groups.find((g) => g.kind === 'home');
  const roomGroups = groups.filter((g) => g.kind === 'room');

  return (
    <>
      {roomGroups.map((g) => (
        <LightTile
          key={g.id}
          group={g}
          on={shown(g.id, g.on)}
          pending={pending(g.id)}
          stale={down}
          busy={busyId === g.id}
          onToggle={(on) => toggle(g, on)}
          onDimmed={() => (expect(g.id, true), burst())}
        />
      ))}
      {home && (
        <button
          className={`quick-tile quick-all ${down ? 'stale' : ''}`}
          disabled={down || busyId === home.id || !roomGroups.some((g) => shown(g.id, g.on))}
          onClick={() => toggle(home, false)}
        >
          {down && <Stale />}
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

const DIM_STEP = 10;

/** Ett Hue-rom: trykk slår av/på, −/+ dimmer i steg på 10 % (og slår på). */
function LightTile({ group: g, on, pending, stale, busy, onToggle, onDimmed }: {
  group: HueGroup;
  on: boolean;
  pending: boolean;
  stale: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onDimmed: () => void;
}) {
  const [level, setLevel] = useState<number | null>(g.brightness);
  const [error, setError] = useState(false);
  const dimming = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // Synk fra Hue når vi ikke har ulagrede endringer
  useEffect(() => {
    if (!dimming.current) setLevel(g.brightness);
  }, [g.brightness]);

  const canDim = !stale && g.brightness != null;

  function adjust(delta: number) {
    const from = on ? (level ?? 100) : 0;
    const next = Math.min(100, Math.max(1, Math.round((from + delta) / DIM_STEP) * DIM_STEP));
    setLevel(next);
    dimming.current = true;
    window.clearTimeout(timer.current);
    // Vent til man har sluttet å trykke, så sendes bare siste nivå
    timer.current = window.setTimeout(async () => {
      try {
        await api.hueDimGroup(g.id, next);
        setError(false);
      } catch {
        setError(true);
      } finally {
        dimming.current = false;
        onDimmed();
      }
    }, 600);
  }

  const lit = on || dimming.current;
  return (
    <div className={`quick-tile quick-light ${lit ? 'on' : ''} ${pending ? 'pending' : ''} ${stale ? 'stale' : ''}`}>
      {stale && <Stale />}
      <button className="quick-light-toggle" aria-pressed={on} disabled={stale || busy} onClick={() => onToggle(!on)}>
        <span className="quick-head">
          <Icon name="bulb" />
          <span className="quick-name">{g.name}</span>
        </span>
        <strong className="quick-value">{lit ? (level != null ? `${level} %` : 'På') : 'Av'}</strong>
        <span className="small">{pending ? (on ? 'Slår på …' : 'Slår av …') : error ? 'Ikke lagret – prøv igjen' : 'Lys'}</span>
      </button>
      {canDim && (
        <div className="quick-heat-btns">
          <button aria-label={`Dimm ned lyset i ${g.name}`} disabled={!lit || (level ?? 100) <= 1} onClick={() => adjust(-DIM_STEP)}>
            <Icon name="minus" />
          </button>
          <button aria-label={`Skru opp lyset i ${g.name}`} disabled={lit && (level ?? 100) >= 100} onClick={() => adjust(DIM_STEP)}>
            <Icon name="plus" />
          </button>
        </div>
      )}
    </div>
  );
}

const SONOS_ROOM = 'Stue';
const SONOS_FAV_KEY = 'sonos.quickFavorite';

/** Start/stopp musikk i stua med valgt favoritt (NRK P2 som standard). Spiller bare på stue-høyttaleren. */
function QuickSonos() {
  const [busy, setBusy] = useState(false);
  const [favId, setFavId] = useState(() => localStorage.getItem(SONOS_FAV_KEY) ?? '');
  const [volume, setVolume] = useState<number | null>(null);
  const volTimer = useRef<number | undefined>(undefined);
  const { data, down, burst } = useServicePoll<SonosOverview>(
    async () => ((await api.sonosStatus()).connected ? api.sonosOverview() : OFF),
    60_000, // Sonos: maks 20 000 kall/døgn,
    [],
  );
  const { expect, shown, pending } = useExpected<boolean>((id) => {
    const g = data?.groups.find((x) => x.id === id);
    return g && (g.state === 'playing' || g.state === 'buffering');
  });

  if (!data) return null;
  const group = data.groups.find((g) => g.players.some((p) => p.toLowerCase() === SONOS_ROOM.toLowerCase()));
  if (!group) return null;
  const playerId = group.playerIds[group.players.findIndex((p) => p.toLowerCase() === SONOS_ROOM.toLowerCase())];
  const fav =
    data.favorites.find((f) => f.id === favId) ?? data.favorites.find((f) => /p2/i.test(f.name)) ?? data.favorites[0];
  const playing = shown(group.id, group.state === 'playing' || group.state === 'buffering');

  async function run(fn: () => Promise<unknown>, on: boolean) {
    setBusy(true);
    expect(group!.id, on);
    // Feiler det, viser de tette hentingene riktig status – eller merker flisen som uten kontakt
    await fn().catch(() => {});
    setBusy(false);
    burst();
  }
  const play = (id: string) => run(() => api.sonosPlayerFavorite(playerId, id), true);
  // Lokal verdi mens trykkene samles opp; sendes 600 ms etter siste trykk
  const shownVolume = volume ?? group.volume;
  function adjustVolume(delta: number) {
    if (shownVolume == null) return;
    const next = Math.min(100, Math.max(0, Math.round((shownVolume + delta) / 5) * 5));
    setVolume(next);
    window.clearTimeout(volTimer.current);
    volTimer.current = window.setTimeout(async () => {
      await api.sonosVolume(group!.id, next).catch(() => {});
      setVolume(null);
      burst();
    }, 600);
  }

  return (
    <div className={`quick-tile quick-sonos ${playing ? 'on' : ''} ${pending(group.id) ? 'pending' : ''} ${down ? 'stale' : ''}`}>
      {down && <Stale />}
      <div className="quick-head">
        <Icon name="music" />
        <span className="quick-name">{SONOS_ROOM}</span>
      </div>
      <strong className="quick-value">
        {pending(group.id) ? (playing ? 'Starter …' : 'Stopper …') : playing ? (group.track?.source ?? group.track?.title ?? 'Spiller') : 'Stille'}
      </strong>
      <span className="muted small">
        {playing && group.track?.title && group.track.source ? group.track.title : 'Musikk'}
        {shownVolume != null && ` · ${shownVolume} %`}
      </span>
      <div className="quick-sonos-ctl">
        <button
          aria-label={playing ? `Stopp musikken i ${SONOS_ROOM}` : `Spill ${fav?.name ?? ''} i ${SONOS_ROOM}`}
          disabled={down || busy || (!playing && !fav)}
          onClick={() => (playing ? run(() => api.sonosCommand(group.id, 'pause'), false) : fav && play(fav.id))}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        {data.favorites.length > 0 && (
          <select
            value={fav?.id ?? ''}
            aria-label={`Favoritt i ${SONOS_ROOM}`}
            disabled={down || busy}
            onChange={(e) => {
              setFavId(e.target.value);
              localStorage.setItem(SONOS_FAV_KEY, e.target.value);
              if (playing) play(e.target.value); // bytt kanal med en gang når det allerede spiller
            }}
          >
            {data.favorites.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}
      </div>
      {shownVolume != null && (
        <div className="quick-heat-btns">
          <button aria-label={`Senk volumet i ${SONOS_ROOM}`} disabled={down || shownVolume <= 0} onClick={() => adjustVolume(-5)}>
            <Icon name="minus" />
          </button>
          <button aria-label={`Øk volumet i ${SONOS_ROOM}`} disabled={down || shownVolume >= 100} onClick={() => adjustVolume(5)}>
            <Icon name="plus" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Mill-enheter uten rom (f.eks. stikkontakter): trykk slår av/på, med effekt, temperatur og fukt. */
function QuickDevices({ houseId, refreshKey }: { houseId: string; refreshKey?: unknown }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data: devices, down, burst } = useServicePoll<Device[]>(
    async () => (await api.independentDevices(houseId)).items,
    60_000, // Mill: maks 2500 kall/time
    [houseId, refreshKey],
  );
  const { expect, shown, pending } = useExpected<boolean | null>((id) => devices?.find((d) => d.deviceId === id)?.isEnabled);

  async function toggle(d: Device, enabled: boolean) {
    setBusyId(d.deviceId);
    expect(d.deviceId, enabled);
    // Feiler det, viser de tette hentingene riktig status – eller merker flisene som uten kontakt
    await api.setDeviceEnabled(d.deviceId, enabled).catch(() => {});
    setBusyId(null);
    burst();
  }

  if (!devices) return null;

  return (
    <>
      {devices.map((d) => {
        const m = d.lastMetrics;
        const enabled = shown(d.deviceId, d.isEnabled);
        const on = d.isConnected && enabled === true;
        const power = Math.round(m?.currentPower ?? 0);
        const canToggle = d.isEnabled != null && d.isConnected;
        return (
          <button
            key={d.deviceId}
            className={`quick-tile quick-device ${on ? 'on' : ''} ${pending(d.deviceId) ? 'pending' : ''} ${d.isConnected ? '' : 'offline'} ${down ? 'stale' : ''}`}
            aria-pressed={enabled ?? undefined}
            disabled={down || !canToggle || busyId === d.deviceId}
            onClick={() => toggle(d, !enabled)}
          >
            {down && <Stale />}
            <span className="quick-head">
              <Icon name="plug" />
              <span className="quick-name">{d.customName?.trim() || d.deviceType.childType.name}</span>
            </span>
            <strong className="quick-value">
              {!d.isConnected ? 'Frakoblet' : enabled == null ? `${power} W` : on ? 'På' : 'Av'}
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

/**
 * Ønsket tilstand etter et trykk, holdt til hentet status bekrefter den (eller 20 s har gått).
 * Uten dette ville flisen blaffe tilbake når en tett henting kommer før enheten har byttet.
 */
function useExpected<T>(actual: (id: string) => T | undefined) {
  const [expected, setExpected] = useState<Record<string, { value: T; until: number }>>({});
  const now = Date.now();
  const live = Object.fromEntries(
    Object.entries(expected).filter(([id, e]) => e.until > now && actual(id) !== e.value),
  ) as typeof expected;
  // Rydd bort bekreftede/utløpte i neste runde
  useEffect(() => {
    if (Object.keys(live).length !== Object.keys(expected).length) setExpected(live);
  });
  useEffect(() => {
    if (!Object.keys(live).length) return;
    const t = setTimeout(() => setExpected((e) => ({ ...e })), 20_000);
    return () => clearTimeout(t);
  }, [expected]);
  return {
    expect: (id: string, value: T) => setExpected((e) => ({ ...e, [id]: { value, until: Date.now() + 20_000 } })),
    /** viste verdi: ønsket mens den venter på bekreftelse, ellers faktisk */
    shown: (id: string, fallback: T) => (id in live ? live[id].value : fallback),
    pending: (id: string) => id in live,
  };
}

/** Liten, rolig merkelapp på fliser der tjenesten ikke svarer (verdiene er sist kjente). */
function Stale() {
  return (
    <span className="quick-stale" title="Tjenesten svarer ikke – viser sist kjente verdier. Prøver igjen av seg selv.">
      Ingen kontakt
    </span>
  );
}

/** Rommets temperatur og luftfuktighet nå, og settpunktet for modusen som gjelder akkurat nå, med −/+ knapper. */
function HeatTile({ room, stale, onChanged }: { room: Room; stale: boolean; onChanged: () => void }) {
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
  const canChange = !stale && room.changeTemperature && target != null && effective !== 'off';

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
        onChanged(); // Dashboard henter rommene tett en stund, så «varmer» kommer fort
      }
    }, 800);
  }

  return (
    <div className={`quick-tile quick-heat ${room.roomHeatStatus ? 'heating' : ''} ${room.isRoomOnline ? '' : 'offline'} ${stale ? 'stale' : ''}`}>
      {stale && <Stale />}
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
      {error && <span className="muted small">Ikke lagret – prøv igjen</span>}
    </div>
  );
}
