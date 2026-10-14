import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { OverrideMode, Room, RoomProgram } from '../types';
import { MODE_LABEL, fmtKwh, fmtTemp, fmtTime } from '../format';
import { DeviceList } from './DeviceList';

type TempKey = 'roomComfortTemperature' | 'roomSleepTemperature' | 'roomAwayTemperature';
const TEMPS: { key: TempKey; label: string }[] = [
  { key: 'roomComfortTemperature', label: 'Komfort' },
  { key: 'roomSleepTemperature', label: 'Natt' },
  { key: 'roomAwayTemperature', label: 'Borte' },
];
const OVERRIDE_MODES: OverrideMode[] = ['comfort', 'sleep', 'away', 'off'];
const DURATIONS = [
  { label: '1 time', hours: 1 },
  { label: '3 timer', hours: 3 },
  { label: '8 timer', hours: 8 },
  { label: 'Til avbrutt', hours: 0 },
];

export function RoomCard({ room, programs, onChanged }: { room: Room; programs: RoomProgram[]; onChanged: () => void }) {
  const [temps, setTemps] = useState(() => pickTemps(room));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDevices, setShowDevices] = useState(false);
  const [duration, setDuration] = useState(3);
  const [editingName, setEditingName] = useState<string | null>(null);
  const pending = useRef<Partial<Record<TempKey, number>>>({});
  const timer = useRef<number | undefined>(undefined);

  // Synk fra server når vi ikke har ulagrede endringer
  useEffect(() => {
    if (Object.keys(pending.current).length === 0) setTemps(pickTemps(room));
  }, [room]);

  const maxTemp = room.roomMaxTemperature ? Number(room.roomMaxTemperature) : 35;
  const isOverride = room.overrideModeType != null;
  const effective = room.mode === 'weekly_program' ? (room.activeModeFromWeeklyProgram ?? 'weekly_program') : room.mode;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Noe gikk galt');
    } finally {
      setBusy(false);
    }
  }

  function adjust(key: TempKey, delta: number) {
    const current = temps[key];
    if (current == null) return;
    const next = Math.min(maxTemp, Math.max(5, Math.round((current + delta) * 2) / 2));
    setTemps((t) => ({ ...t, [key]: next }));
    pending.current[key] = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const body = pending.current;
      pending.current = {};
      run(() => api.setRoomTemperature(room.id, body));
    }, 800);
  }

  function saveName() {
    const name = editingName?.trim();
    setEditingName(null);
    if (name && name !== room.name) run(() => api.renameRoom(room.id, name));
  }

  function override(mode: OverrideMode) {
    const end = duration ? Math.floor(Date.now() / 1000) + duration * 3600 : null;
    run(() => api.overrideRoom(room.id, mode, end));
  }

  return (
    <article className={`card room ${room.isRoomOnline ? '' : 'offline'}`}>
      <div className="room-head">
        {editingName != null ? (
          <input
            className="name-input"
            value={editingName}
            maxLength={50}
            autoFocus
            aria-label="Romnavn"
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName();
              if (e.key === 'Escape') setEditingName(null);
            }}
          />
        ) : (
          <h3>
            {room.name}
            <button className="icon" aria-label="Gi rommet nytt navn" title="Gi nytt navn" onClick={() => setEditingName(room.name)}>
              ✎
            </button>
          </h3>
        )}
        {room.roomHeatStatus && <span className="pill heat" title="Varmer nå">🔥 Varmer</span>}
        {room.roomOpenWindowStatus && <span className="pill warn" title="Åpent vindu oppdaget">Åpent vindu</span>}
        {!room.isRoomOnline && <span className="pill warn">Frakoblet</span>}
      </div>

      <div className="room-now">
        <div className="big">{fmtTemp(room.averageTemperature)}</div>
        <div className="room-meta">
          {room.roomHumidity != null && <span>💧 {Math.round(room.roomHumidity)} %</span>}
          <span>
            {MODE_LABEL[effective ?? 'weekly_program']}
            {room.mode === 'weekly_program' && room.roomProgramName ? ` · ${room.roomProgramName}` : ''}
          </span>
          <span className="muted">
            {room.roomOnlineDevicesNumber}/{room.roomTotalDevicesNumber} enheter · i dag {fmtKwh(room.roomEnergyUsage)}
          </span>
        </div>
      </div>

      <div className="temps">
        {TEMPS.map(({ key, label }) => (
          <div className="temp" key={key}>
            <span className="muted small">{label}</span>
            <div className="stepper">
              <button
                aria-label={`Senk ${label}`}
                disabled={!room.changeTemperature || temps[key] == null}
                onClick={() => adjust(key, -0.5)}
              >
                −
              </button>
              <span>{fmtTemp(temps[key])}</span>
              <button
                aria-label={`Øk ${label}`}
                disabled={!room.changeTemperature || temps[key] == null}
                onClick={() => adjust(key, 0.5)}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      <label className="program-select">
        <span className="muted small">Ukeprogram</span>
        <select
          value={room.roomProgramId ?? ''}
          disabled={busy}
          onChange={(e) => run(() => api.setRoomProgram(room.id, e.target.value || null))}
        >
          <option value="">Ingen</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <div className="override">
        {isOverride ? (
          <div className="override-active">
            <span>
              Overstyrt: <strong>{MODE_LABEL[room.mode ?? 'normal']}</strong>
              {room.overrideEndDate ? ` til ${fmtTime(room.overrideEndDate)}` : ''}
            </span>
            <button disabled={busy} onClick={() => run(() => api.cancelRoomOverride(room.id))}>
              Avbryt
            </button>
          </div>
        ) : (
          <>
            <div className="override-row">
              <span className="muted small">Overstyr</span>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Varighet">
                {DURATIONS.map((d) => (
                  <option key={d.hours} value={d.hours}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="seg">
              {OVERRIDE_MODES.map((m) => (
                <button key={m} disabled={busy} onClick={() => override(m)}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {error && <p className="error small">{error}</p>}

      <button className="link" onClick={() => setShowDevices((s) => !s)}>
        {showDevices ? 'Skjul enheter' : 'Vis enheter'}
      </button>
      {showDevices && <DeviceList source={{ roomId: room.id }} onMoved={onChanged} />}
    </article>
  );
}

function pickTemps(r: Room): Record<TempKey, number | null> {
  return {
    roomComfortTemperature: r.roomComfortTemperature,
    roomSleepTemperature: r.roomSleepTemperature,
    roomAwayTemperature: r.roomAwayTemperature,
  };
}
