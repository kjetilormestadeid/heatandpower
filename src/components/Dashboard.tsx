import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Clock } from './Clock';
import { CalendarDrawer, refreshCalendar } from './CalendarDrawer';

const POLL_MS = 60_000; // Mill tillater 2500 kall/time per kunde
const IDLE_MS = 90_000; // tilbake til hurtigpanelet etter så lang tid uten berøring

export function Dashboard({ user, onLogout }: { user: string; onLogout: () => void }) {
  const [houses, setHouses] = useState<House[] | null>(null);
  const [houseId, setHouseId] = useState<string | null>(() => localStorage.getItem('mill.houseId'));
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [independentCount, setIndependentCount] = useState(0);
  const [programs, setPrograms] = useState<RoomProgram[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [roomsDown, setRoomsDown] = useState(false);
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
      setRoomsDown(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke hente rom');
      setRoomsDown(true);
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
  const mainRef = useRef<HTMLElement>(null);

  // Nettbrett: gå tilbake til start (hurtigpanelet) når ingen har rørt skjermen en stund
  useEffect(() => {
    const main = mainRef.current;
    let t: number | undefined;
    // Så lenge ingen har rørt skjermen holdes visningen på hurtigpanelet. Ellers kan scroll-snap
    // hoppe til et annet kort når seksjoner lastes inn og bytter størrelse.
    let atHome = true;
    const goHome = () => {
      atHome = true;
      main?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
      main?.querySelectorAll<HTMLElement>(':scope > *').forEach((el) => el.scrollTo({ top: 0, behavior: 'smooth' }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const onActivity = () => {
      atHome = false;
      window.clearTimeout(t);
      t = window.setTimeout(goHome, IDLE_MS);
    };
    const pin = new MutationObserver(() => atHome && main && main.scrollLeft !== 0 && (main.scrollLeft = 0));
    if (main) pin.observe(main, { childList: true, subtree: true, characterData: true });
    const events = ['pointerdown', 'keydown', 'wheel', 'touchmove'] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      window.clearTimeout(t);
      pin.disconnect();
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, []);

  return (
    <div className="layout">
      <header className="topbar">
        {houses && houses.length > 1 ? (
          <select className="house-select" value={houseId ?? ''} onChange={(e) => setHouseId(e.target.value)} aria-label="Velg hus">
            {houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="brand">{house?.name ?? 'Mill Oversikt'}</div>
        )}
        {house && <span className="pill">{house.isVacationModeActive ? 'Ferie' : MODE_LABEL[house.mode ?? 'weekly_program']}</span>}
        <div className="spacer" />
        <Clock />
        <div className="spacer" />
        {updatedAt && (
          <span className="muted small hide-sm">
            Oppdatert {updatedAt.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <CalendarDrawer />
        {house && (
          <button
            onClick={() => {
              loadRooms();
              refreshCalendar();
            }}
          >
            Oppdater
          </button>
        )}
        <button onClick={onLogout} title={user}>Logg ut</button>
      </header>

      <main ref={mainRef}>
        {/* Har vi rom fra før, vises feilen rolig på flisene i stedet */}
        {error && !rooms && <p className="error banner">{error}</p>}
        {houses && houses.length === 0 && <p className="muted">Ingen hus funnet på denne kontoen.</p>}

        {houseId && (
          <QuickPanel
            houseId={houseId}
            rooms={rooms}
            roomsDown={roomsDown}
            independentCount={independentCount}
            refreshKey={reloadKey}
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
