import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { House, Room, RoomProgram } from '../types';
import { MODE_LABEL } from '../format';
import { RoomCard } from './RoomCard';
import { EnergyChart } from './EnergyChart';
import { DeviceList } from './DeviceList';
import { ProgramsSection } from './ProgramsSection';
import { TibberSection } from './TibberSection';
import { ConsumptionCompare } from './ConsumptionCompare';
import { ActiveNow } from './ActiveNow';
import { EaseeSection } from './EaseeSection';
import { HueSection } from './HueSection';
import { EnergySum } from './EnergySum';
import { PresenceSection } from './PresenceSection';
import { SonosSection } from './SonosSection';
import { DiagnosticsSection } from './DiagnosticsSection';
import { QuickPanel } from './QuickPanel';

const POLL_MS = 60_000; // Mill tillater 2500 kall/time per kunde

export function Dashboard({ user, onLogout }: { user: string; onLogout: () => void }) {
  const [houses, setHouses] = useState<House[] | null>(null);
  const [houseId, setHouseId] = useState<string | null>(() => localStorage.getItem('mill.houseId'));
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [independentCount, setIndependentCount] = useState(0);
  const [programs, setPrograms] = useState<RoomProgram[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    api.houses().then(
      (r) => {
        const all = [...r.ownHouses, ...r.sharedHouses.map((s) => s.house)];
        setHouses(all);
        setHouseId((cur) => (cur && all.some((h) => h.id === cur) ? cur : (all[0]?.id ?? null)));
      },
      (e) => setError(e.message),
    );
  }, []);

  const loadRooms = useCallback(async () => {
    if (!houseId) return;
    try {
      const [r, p] = await Promise.all([api.rooms(houseId), api.roomPrograms(houseId)]);
      setPrograms(p.items);
      setRooms(r.rooms);
      setIndependentCount(r.independentDeviceIds.length);
      setUpdatedAt(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente rom');
    }
  }, [houseId]);

  useEffect(() => {
    if (!houseId) return;
    localStorage.setItem('mill.houseId', houseId);
    setRooms(null);
    loadRooms();
    const t = setInterval(() => document.visibilityState === 'visible' && loadRooms(), POLL_MS);
    return () => clearInterval(t);
  }, [houseId, loadRooms]);

  const house = houses?.find((h) => h.id === houseId);

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">Mill Oversikt</div>
        {houses && houses.length > 0 && (
          <select value={houseId ?? ''} onChange={(e) => setHouseId(e.target.value)} aria-label="Velg hus">
            {houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        )}
        <div className="spacer" />
        <span className="muted small hide-sm">{user}</span>
        <button onClick={onLogout}>Logg ut</button>
      </header>

      <main>
        {error && <p className="error banner">{error}</p>}
        {houses && houses.length === 0 && <p className="muted">Ingen hus funnet på denne kontoen.</p>}

        {house && (
          <div className="section-head">
            <h2>{house.name}</h2>
            <span className="pill">{house.isVacationModeActive ? 'Ferie' : MODE_LABEL[house.mode ?? 'weekly_program']}</span>
            <div className="spacer" />
            {updatedAt && (
              <span className="muted small">
                Oppdatert {updatedAt.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button onClick={loadRooms}>Oppdater</button>
          </div>
        )}

        {houseId && (
          <QuickPanel
            rooms={rooms}
            onRoomsChanged={() => {
              loadRooms();
              setReloadKey((k) => k + 1);
            }}
          />
        )}

        <PresenceSection />

        {houseId && rooms && rooms.length > 0 && <ActiveNow houseId={houseId} rooms={rooms} refreshKey={reloadKey} />}

        {houseId && <EnergySum houseId={houseId} />}

        {houseId && !rooms && !error && <p className="muted">Henter rom…</p>}
        {rooms && rooms.length === 0 && <p className="muted">Ingen rom i dette huset.</p>}
        {rooms && (
          <div className="grid">
            {rooms.map((r) => (
              <RoomCard
                key={r.id}
                room={r}
                programs={programs}
                onChanged={() => {
                  loadRooms();
                  setReloadKey((k) => k + 1);
                }}
              />
            ))}
          </div>
        )}

        {houseId && independentCount > 0 && (
          <section className="card room">
            <div className="room-head">
              <h3>Enheter uten rom</h3>
              <span className="muted small">Kan styres med egne tidsplaner</span>
            </div>
            <DeviceList key={`${houseId}-${reloadKey}`} source={{ houseId }} onMoved={loadRooms} />
          </section>
        )}

        {houseId && rooms && (
          <ProgramsSection houseId={houseId} programs={programs} rooms={rooms} onChanged={loadRooms} />
        )}

        <TibberSection />

        {houseId && <ConsumptionCompare houseId={houseId} />}

        <EaseeSection />

        <HueSection />

        <SonosSection />

        {houseId && <EnergyChart houseId={houseId} />}

        <DiagnosticsSection />
      </main>
    </div>
  );
}
