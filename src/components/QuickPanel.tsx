import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { HueGroup, Room, TibberLive } from '../types';
import { MODE_LABEL, fmtTemp } from '../format';
import { Icon } from './Icon';

type TempKey = 'roomComfortTemperature' | 'roomSleepTemperature' | 'roomAwayTemperature';

/** Hurtigpanel øverst for nettbrett: totalforbruk, lys av/på per rom og varme opp/ned per rom. */
export function QuickPanel({ rooms, onRoomsChanged }: { rooms: Room[] | null; onRoomsChanged: () => void }) {
  return (
    <section className="card quick">
      <QuickEnergy rooms={rooms} />
      <QuickLights />
      {rooms && rooms.length > 0 && (
        <div className="quick-block">
          <h2>Varme</h2>
          <div className="quick-grid heat">
            {rooms.map((r) => (
              <HeatTile key={r.id} room={r} onChanged={onRoomsChanged} />
            ))}
          </div>
        </div>
      )}
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

/** Store av/på-knapper per Hue-rom. Vises bare når Hue er koblet til. */
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
    <div className="quick-block">
      <div className="section-head">
        <h2>Lys</h2>
        <div className="spacer" />
        {home && (
          <button className="quick-all" disabled={busyId === home.id || !roomGroups.some((g) => g.on)} onClick={() => toggle(home, false)}>
            Slå av alt
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
      <div className="quick-grid">
        {roomGroups.map((g) => (
          <button
            key={g.id}
            className={`quick-light ${g.on ? 'on' : ''}`}
            aria-pressed={g.on}
            disabled={busyId === g.id}
            onClick={() => toggle(g, !g.on)}
          >
            <Icon name="bulb" />
            <span className="quick-name">{g.name}</span>
            <span className="small">{g.on ? (g.brightness != null ? `På · ${g.brightness} %` : 'På') : 'Av'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Rommets temperatur nå og settpunktet for modusen som gjelder akkurat nå, med store −/+ knapper. */
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
    <div className={`quick-heat ${room.roomHeatStatus ? 'heating' : ''} ${room.isRoomOnline ? '' : 'offline'}`}>
      <div className="quick-heat-head">
        <span className="quick-name">{room.name}</span>
        {room.roomHeatStatus && <Icon name="flame" />}
      </div>
      <div className="quick-heat-now">
        <strong>{fmtTemp(room.averageTemperature)}</strong>
        <span className="muted small">
          {MODE_LABEL[effective ?? 'weekly_program']}
          {target != null && effective !== 'off' ? ` · mål ${fmtTemp(target)}` : ''}
        </span>
      </div>
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
