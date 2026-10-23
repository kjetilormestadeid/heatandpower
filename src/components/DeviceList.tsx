import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Device } from '../types';
import { fmtKwh, fmtTemp } from '../format';
import { TimerPlan } from './TimerPlan';
import { Icon } from './Icon';
import { HumidityControl } from './HumidityControl';

type Source = { roomId: string; houseId?: never } | { houseId: string; roomId?: never };

export function DeviceList({ source, onMoved }: { source: Source; onMoved?: () => void }) {
  const { roomId, houseId } = source;
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [humFor, setHumFor] = useState<string | null>(null);

  const load = useCallback(() => {
    const req = roomId
      ? api.roomDevices(roomId).then((r) => r.devices)
      : api.independentDevices(houseId!).then((r) => r.items);
    req.then(setDevices, (e) => setError(e.message));
  }, [roomId, houseId]);

  useEffect(load, [load]);

  async function toggle(d: Device) {
    setBusyId(d.deviceId);
    setError(null);
    try {
      await api.setDeviceEnabled(d.deviceId, !d.isEnabled);
      setDevices((list) => list?.map((x) => (x.deviceId === d.deviceId ? { ...x, isEnabled: !d.isEnabled } : x)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke endre enheten');
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <p className="error small">{error}</p>;
  if (!devices) return <p className="muted small">Henter enheter…</p>;
  if (devices.length === 0) return <p className="muted small">Ingen enheter.</p>;

  return (
    <ul className="devices">
      {devices.map((d) => {
        const m = d.lastMetrics;
        return (
          <li key={d.deviceId}>
            <div className="dev-row">
              <div>
                <div className="dev-name">
                  <span className={`dot ${d.isConnected ? 'on' : 'off'}`} aria-label={d.isConnected ? 'Tilkoblet' : 'Frakoblet'} />
                  {d.customName || d.deviceType.childType.name}
                </div>
                <div className="muted small">
                  {d.deviceType.parentType.name}
                  {m?.temperatureAmbient != null && ` · ${fmtTemp(m.temperatureAmbient)}`}
                  {/* Ovner melder 0 – vis bare for enheter med fuktsensor (f.eks. stikkontakter) */}
                  {m?.humidity != null && m.humidity > 0 && (
                    <>
                      {' · '}
                      <span className="with-icon"><Icon name="droplet" /> {Math.round(m.humidity)} %</span>
                    </>
                  )}
                  {m?.currentPower != null && ` · ${Math.round(m.currentPower)} W`}
                  {` · i dag ${fmtKwh(d.energyUsageForCurrentDay)}`}
                </div>
                <div className="dev-links">
                  <button className="link small" onClick={() => setPlanFor((cur) => (cur === d.deviceId ? null : d.deviceId))}>
                    {planFor === d.deviceId ? 'Skjul tidsplan' : 'Tidsplan'}
                  </button>
                  {/* Fuktstyring for enheter med fuktsensor (stikkontakter) */}
                  {(m?.humidity ?? 0) > 0 && d.houseId && (
                    <button className="link small" onClick={() => setHumFor((cur) => (cur === d.deviceId ? null : d.deviceId))}>
                      {humFor === d.deviceId ? 'Skjul fuktstyring' : 'Fuktstyring'}
                    </button>
                  )}
                </div>
              </div>
              {d.isEnabled != null && (
                <label className="switch" title={d.isEnabled ? 'Slå av' : 'Slå på'}>
                  <input
                    type="checkbox"
                    checked={d.isEnabled}
                    disabled={busyId === d.deviceId || !d.isConnected}
                    onChange={() => toggle(d)}
                  />
                  <span />
                </label>
              )}
            </div>
            {humFor === d.deviceId && d.houseId && (
              <HumidityControl deviceId={d.deviceId} houseId={d.houseId} name={(d.customName || d.deviceType.childType.name).trim()} />
            )}
            {planFor === d.deviceId && (
              <TimerPlan
                device={d}
                onMoved={() => {
                  setPlanFor(null);
                  load();
                  onMoved?.();
                }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
