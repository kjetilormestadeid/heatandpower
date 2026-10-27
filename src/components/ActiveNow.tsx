import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { AppliancesResponse, Device, Room, TibberLive } from '../types';
import { hueWatts } from './HueSection';
import { IdentifyAppliance } from './IdentifyAppliance';

export interface ActiveDevice {
  id: string;
  name: string;
  /** Romnavn, eller null for enheter uten rom */
  room: string | null;
  type: string;
  isConnected: boolean;
  isEnabled: boolean | null;
  /** Sist målte effekt i watt */
  power: number;
  /** Effekten er beregnet, ikke målt (f.eks. Hue-lamper) */
  estimated?: boolean;
}

export type ActiveStatus = 'drawing' | 'idle' | 'off' | 'offline';

/** Trekker strøm = tilkoblet og effekt > 0. Frakoblede enheters målinger kan være utdaterte. */
export function statusOf(d: ActiveDevice): ActiveStatus {
  if (!d.isConnected) return 'offline';
  if (d.isEnabled === false) return 'off';
  return d.power > 0 ? 'drawing' : 'idle';
}

const toActive = (d: Device, room: string | null): ActiveDevice => ({
  id: d.deviceId,
  name: d.customName?.trim() || d.deviceType.childType.name,
  room,
  type: d.deviceType.parentType.name,
  isConnected: d.isConnected,
  isEnabled: d.isEnabled,
  power: Math.max(0, Math.round(d.lastMetrics?.currentPower ?? 0)),
});

/** Henter alle enheter i huset (per rom + uten rom) og viser tydelig hva som står på akkurat nå. */
const DEVICES_POLL_MS = 2 * 60_000;

export function ActiveNow({ houseId, rooms, refreshKey }: { houseId: string; rooms: Room[]; refreshKey?: unknown }) {
  const [devices, setDevices] = useState<ActiveDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [house, setHouse] = useState<TibberLive | null>(null);
  const [appliances, setAppliances] = useState<AppliancesResponse | null>(null);
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const loadAppliances = useCallback(() => api.appliances().then(setAppliances, () => {}), []);

  // Tibber Pulse: hele husets forbruk og gjenkjente apparater, oppdateres hvert 10. sekund mens fanen er synlig
  useEffect(() => {
    let stop = false;
    const poll = () =>
      document.visibilityState === 'visible' &&
      api.tibberStatus()
        .then((s) => (s.configured ? Promise.all([api.tibberLive(), loadAppliances()]).then(([l]) => l) : { live: null, error: null }))
        .then((r) => !stop && setHouse(r.live), () => {});
    poll();
    const t = setInterval(poll, 10_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [loadAppliances]);

  // Rommene lastes på nytt hvert minutt (nytt array hver gang) – hent bare enhetene på nytt når
  // settet av rom endrer seg, ved egne endringer (refreshKey) eller på eget, roligere intervall.
  // Hvert rom er ett Mill-kall, og Mill tillater 2500 kall/time.
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const roomKey = rooms.map((r) => `${r.id}:${r.name}`).join('|');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && setTick((n) => n + 1), DEVICES_POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const rooms = roomsRef.current;
    Promise.all([
      ...rooms.map((r) => api.roomDevices(r.id).then((res) => res.devices.map((d) => toActive(d, r.name)))),
      api.independentDevices(houseId).then((res) => res.items.map((d) => toActive(d, null))),
      // Easee er valgfritt – laderne vises med målt effekt
      api.easeeStatus()
        .then((s) => (s.configured ? api.easeeChargers() : { chargers: [] }))
        .then((r) =>
          Promise.all(
            r.chargers.map(async (c): Promise<ActiveDevice> => {
              const { state } = await api.easeeCharger(c.id);
              const charging = state.chargerOpMode === 3;
              return {
                id: `easee-${c.id}`, name: c.name || 'Elbillader', room: 'Elbillading', type: 'Easee',
                isConnected: state.isOnline, isEnabled: true, power: charging ? Math.round(state.totalPower * 1000) : 0,
              };
            }),
          ),
        )
        .catch(() => [] as ActiveDevice[]),
      // Hue er valgfritt – ingen feil om det ikke er koblet til
      api.hueStatus()
        .then((s) => (s.connected ? api.hueLights() : { lights: [] }))
        .then((r) =>
          r.lights.map((l): ActiveDevice => ({
            id: `hue-${l.id}`, name: l.name, room: l.room, type: 'Hue', isConnected: true, isEnabled: l.on, power: hueWatts(l), estimated: true,
          })),
        )
        .catch(() => [] as ActiveDevice[]),
    ]).then(
      (lists) => !cancelled && (setDevices(lists.flat()), setError(null)),
      (e) => !cancelled && setError(e instanceof Error ? e.message : 'Kunne ikke hente enheter'),
    );
    return () => {
      cancelled = true;
    };
  }, [houseId, roomKey, refreshKey, tick]);

  return (
    <section className="card active-now">
      {error && <p className="error small">{error}</p>}
      {!devices && !error && (
        <>
          <h2>Står på nå</h2>
          <p className="muted small">Henter enheter…</p>
        </>
      )}
      {devices && (
        <ActiveNowView
          devices={[...devices, ...(appliances?.appliances ?? []).map(applianceToActive)]}
          house={house}
          actions={house && (
            <button className={identifyOpen ? 'primary' : ''} onClick={() => setIdentifyOpen((o) => !o)}>
              {identifyOpen ? 'Lukk identifisering' : 'Identifiser apparat'}
            </button>
          )}
        />
      )}
      {identifyOpen && <IdentifyAppliance data={appliances} onChange={loadAppliances} />}
    </section>
  );
}

/** Apparat gjenkjent fra trinn i Tibber Pulse-målingen – effekten er den som ble målt ved identifisering. */
const applianceToActive = (a: AppliancesResponse['appliances'][number]): ActiveDevice => ({
  id: `appliance-${a.id}`, name: a.name, room: 'Gjenkjent fra Pulse', type: 'Apparat',
  isConnected: true, isEnabled: a.on, power: a.on ? a.watts : 0, estimated: true,
});

export const fmtW = (w: number) => (w >= 1000 ? `${(w / 1000).toLocaleString('nb-NO', { maximumFractionDigits: 2 })} kW` : `${w} W`);

/** Ren visning: samlet effekt, enheter som trekker strøm, og resten gruppert etter status. */
export function ActiveNowView({
  devices,
  house,
  actions,
}: {
  devices: ActiveDevice[];
  /** Knapper i overskriften (valgfritt) */
  actions?: ReactNode;
  /** Hele husets forbruk fra Tibber Pulse (valgfritt) */
  house?: Pick<TibberLive, 'power' | 'accumulatedConsumption' | 'accumulatedCost' | 'maxPower'> | null;
}) {
  const by = (s: ActiveStatus) => devices.filter((d) => statusOf(d) === s);
  const drawing = by('drawing').sort((a, b) => b.power - a.power);
  const idle = by('idle');
  const off = by('off');
  const offline = by('offline');
  const total = drawing.reduce((s, d) => s + d.power, 0);
  const anyEstimated = drawing.some((d) => d.estimated);
  const max = drawing[0]?.power ?? 1;

  return (
    <>
      <div className="section-head">
        <h2>Står på nå</h2>
        <div className="spacer" />
        <span className={`pill ${drawing.length ? 'on' : ''}`}>
          {drawing.length ? `${drawing.length} trekker strøm` : 'Ingenting trekker strøm'}
        </span>
        {actions}
      </div>

      {house && <HouseNow house={house} known={total} />}

      <div className="tiles">
        <div className="tile">
          <span className="muted small">{house ? 'Kjente enheter nå' : 'Effekt nå'}</span>
          <strong className="now-total">{anyEstimated ? '≈ ' : ''}{fmtW(total)}</strong>
        </div>
        <div className="tile">
          <span className="muted small">Trekker strøm</span>
          <strong>{drawing.length} av {devices.length}</strong>
        </div>
        {offline.length > 0 && (
          <div className="tile">
            <span className="muted small">Frakoblet</span>
            <strong>{offline.length}</strong>
          </div>
        )}
      </div>

      {drawing.length > 0 && (
        <ul className="active-list">
          {drawing.map((d) => (
            <li key={d.id}>
              <span className="dot on" aria-hidden />
              <div className="active-name">
                <strong>{d.name}</strong>
                <span className="muted small">{d.room ?? 'Uten rom'} · {d.type}</span>
              </div>
              <div className="power-bar" aria-hidden>
                <span style={{ width: `${(d.power / max) * 100}%` }} />
              </div>
              <strong className="active-w">{d.estimated ? '≈ ' : ''}{fmtW(d.power)}</strong>
            </li>
          ))}
        </ul>
      )}

      <div className="status-groups">
        <StatusGroup title="På, men trekker ikke strøm nå" hint="Termostaten er fornøyd, eller ingen bil lader" devices={idle} />
        <StatusGroup title="Slått av" devices={off} />
        <StatusGroup title="Frakoblet" hint="Sist målte verdi kan være utdatert" devices={offline} showPower />
      </div>
    </>
  );
}

function StatusGroup({ title, hint, devices, showPower }: { title: string; hint?: string; devices: ActiveDevice[]; showPower?: boolean }) {
  if (!devices.length) return null;
  return (
    <div className="status-group">
      <div className="small">
        <strong>{title}</strong> <span className="muted">({devices.length}){hint ? ` · ${hint}` : ''}</span>
      </div>
      <div className="chips">
        {devices.map((d) => (
          <span key={d.id} className="chip" title={`${d.room ?? 'Uten rom'} · ${d.type}`}>
            {d.name}
            {showPower && d.power > 0 && <span className="muted"> · sist {fmtW(d.power)}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Hele huset (Tibber Pulse) med fordeling mellom kjente enheter og resten. */
function HouseNow({
  house,
  known,
}: {
  house: Pick<TibberLive, 'power' | 'accumulatedConsumption' | 'accumulatedCost' | 'maxPower'>;
  known: number;
}) {
  const other = Math.max(0, house.power - known);
  const knownShare = house.power > 0 ? Math.min(1, known / house.power) : 0;
  return (
    <div className="house-now">
      <div className="tiles">
        <div className="tile">
          <span className="muted small">Hele huset nå · Tibber Pulse</span>
          <strong className="now-total big-kw">{fmtW(house.power)}</strong>
        </div>
        <div className="tile">
          <span className="muted small">Annet / ukjent</span>
          <strong>{fmtW(other)}</strong>
        </div>
        <div className="tile">
          <span className="muted small">I dag</span>
          <strong>
            {house.accumulatedConsumption.toLocaleString('nb-NO', { maximumFractionDigits: 1 })} kWh
            {house.accumulatedCost != null && ` · ${Math.round(house.accumulatedCost)} kr`}
          </strong>
        </div>
        <div className="tile">
          <span className="muted small">Toppen i dag</span>
          <strong>{fmtW(house.maxPower)}</strong>
        </div>
      </div>
      <div className="split-bar" role="img" aria-label={`Kjente enheter ${fmtW(known)} av ${fmtW(house.power)}`}>
        <span className="known" style={{ width: `${knownShare * 100}%` }} />
      </div>
      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--accent)' }} />Kjente enheter {Math.round(knownShare * 100)} %</span>
        <span><i className="swatch" style={{ background: 'var(--series-2)' }} />Annet (varmtvann, komfyr, …)</span>
      </div>
      {known > house.power * 1.05 && (
        <p className="muted small" style={{ margin: 0 }}>
          Enhetene summerer til mer enn Pulse måler – Mill-målinger kan være noen minutter gamle, og Hue er estimert.
        </p>
      )}
    </div>
  );
}
