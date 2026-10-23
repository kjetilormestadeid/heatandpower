import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { HueGroup, HueLight } from '../types';
import { Icon } from './Icon';

const POLL_MS = 60_000;

/** Hue måler ikke strøm – estimat: ~9 W for en vanlig pære på full styrke, skalert med dimming. */
export const hueWatts = (l: HueLight) => (l.on ? Math.max(1, Math.round(9 * ((l.brightness ?? 100) / 100))) : 0);

/** Philips Hue via Remote API: koble til én gang, deretter lamper per rom med på/av. */
export function HueSection() {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [lights, setLights] = useState<HueLight[] | null>(null);
  const [groups, setGroups] = useState<HueGroup[]>([]);
  const [error, setError] = useState<string | null>(() => new URLSearchParams(location.search).get('hue_error'));
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([api.hueLights(), api.hueGroups()]).then(
        ([l, g]) => (setLights(l.lights), setGroups(g.groups), setError(null)),
        (e) => setError(e.message),
      ),
    [],
  );

  async function rename(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke endre navnet');
    } finally {
      await load();
    }
  }

  async function dim(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke dimme');
    } finally {
      await load();
    }
  }

  async function toggleGroup(g: HueGroup, on: boolean) {
    setBusyId(g.id);
    setError(null);
    try {
      await api.hueSetGroup(g.id, on);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke endre lysene');
    } finally {
      await load();
      setBusyId(null);
    }
  }

  useEffect(() => {
    api.hueStatus().then(setStatus, (e) => setError(e.message));
    // Rydd ?hue=ok / ?hue_error=… fra adressefeltet etter innlogging
    if (location.search.includes('hue')) history.replaceState(null, '', location.pathname);
  }, []);

  useEffect(() => {
    if (!status?.connected) return;
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    return () => clearInterval(t);
  }, [status?.connected, load]);

  async function toggle(l: HueLight) {
    setBusyId(l.id);
    setLights((list) => list?.map((x) => (x.id === l.id ? { ...x, on: !l.on } : x)) ?? null);
    try {
      await api.hueSetLight(l.id, !l.on);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke endre lampen');
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (!status && !error) return null;

  return (
    <section className="card energy">
      <div className="section-head">
        <h2>Lys (Philips Hue)</h2>
        <div className="spacer" />
        {status?.connected && (
          <button className="link small" onClick={() => api.hueLogout().then(() => (setStatus({ ...status, connected: false }), setLights(null)))}>
            Koble fra
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}

      {status && !status.configured && (
        <p className="small" style={{ margin: 0 }}>
          Registrer en app under «Remote Hue API appids» på{' '}
          <a href="https://developers.meethue.com" target="_blank" rel="noreferrer">developers.meethue.com</a> og legg{' '}
          <code>HUE_CLIENT_ID</code> og <code>HUE_CLIENT_SECRET</code> i <code>.env</code>.
        </p>
      )}

      {status?.configured && !status.connected && (
        <div className="charger-actions">
          <a className="button primary" href="/api/hue/login">Koble til Hue</a>
          <span className="muted small">Du sendes til Philips for å godkjenne tilgang.</span>
        </div>
      )}

      {status?.connected && !lights && !error && <p className="muted small">Henter lamper…</p>}
      {lights && (
        <HueView
          lights={lights}
          groups={groups}
          busyId={busyId}
          onToggle={toggle}
          onGroup={toggleGroup}
          onRenameLight={(l, name) => rename(() => api.hueRenameLight(l.id, name))}
          onDimLight={(l, b) => {
            setLights((list) => list?.map((x) => (x.id === l.id ? { ...x, on: true, brightness: b } : x)) ?? null);
            dim(() => api.hueDimLight(l.id, b));
          }}
          onDimGroup={(g, b) => dim(() => api.hueDimGroup(g.id, b))}
          onIdentify={(l) => api.hueIdentifyLight(l.id).catch((e) => setError(e instanceof Error ? e.message : 'Kunne ikke blinke lampen'))}
          onRenameGroup={(g, name) => g.resourceId && g.kind !== 'home' && rename(() => api.hueRenameGroup(g.kind as 'room' | 'zone', g.resourceId!, name))}
        />
      )}
    </section>
  );
}

/** Ren visning: nøkkeltall og lamper gruppert per rom med på/av-bryter. */
export function HueView({
  lights,
  groups = [],
  busyId,
  onToggle,
  onGroup,
  onRenameLight,
  onRenameGroup,
  onIdentify,
  onDimLight,
  onDimGroup,
  defaultOpen = [],
}: {
  lights: HueLight[];
  /** rom/soner/hele hjemmet – gir av/på-knapper for hele grupper */
  groups?: HueGroup[];
  busyId?: string | null;
  onToggle?: (l: HueLight) => void;
  onGroup?: (g: HueGroup, on: boolean) => void;
  /** dimmer per lampe (1–100) */
  onDimLight?: (l: HueLight, brightness: number) => void;
  /** dimmer for hele rommet (1–100) */
  onDimGroup?: (g: HueGroup, brightness: number) => void;
  /** rom som er utvidet fra start */
  defaultOpen?: string[];
  /** gir «blink»-knapp per lampe for å finne den */
  onIdentify?: (l: HueLight) => void;
  /** gir blyant-knapp for å endre lampenavn */
  onRenameLight?: (l: HueLight, name: string) => void;
  /** gir blyant-knapp for å endre romnavn */
  onRenameGroup?: (g: HueGroup, name: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpen));
  const on = lights.filter((l) => l.on);
  const home = groups.find((g) => g.kind === 'home');
  const roomNames = [...new Set(lights.map((l) => l.room ?? 'Uten rom'))];
  const toggleOpen = (room: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(room)) next.delete(room);
      else next.add(room);
      return next;
    });

  return (
    <>
      <div className="hue-summary">
        <div className="tiles">
          <div className="tile">
            <span className="muted small">Lamper på</span>
            <strong>{on.length} av {lights.length}</strong>
          </div>
          <div className="tile">
            <span className="muted small">Estimert effekt</span>
            <strong>≈ {on.reduce((s, l) => s + hueWatts(l), 0)} W</strong>
          </div>
        </div>
        {home && (
          <div className="charger-actions">
            <button disabled={!onGroup || busyId === home.id || on.length === 0} onClick={() => onGroup?.(home, false)}>
              Slå av alle
            </button>
            <button disabled={!onGroup || busyId === home.id || on.length === lights.length} onClick={() => onGroup?.(home, true)}>
              Slå på alle
            </button>
          </div>
        )}
      </div>

      <ul className="hue-list">
        {roomNames.map((room) => {
          const roomLights = lights.filter((l) => (l.room ?? 'Uten rom') === room);
          const onCount = roomLights.filter((l) => l.on).length;
          const g = groups.find((x) => x.kind === 'room' && x.name === room);
          const isOpen = open.has(room);
          return (
            <li key={room} className={`hue-row ${isOpen ? 'open' : ''}`}>
              <div className="hue-row-head">
                <button className="icon hue-expand" aria-expanded={isOpen} aria-label={`${isOpen ? 'Skjul' : 'Vis'} lamper i ${room}`} onClick={() => toggleOpen(room)}>
                  <Icon name={isOpen ? 'chevron-left' : 'chevron-right'} style={{ transform: isOpen ? 'rotate(-90deg)' : undefined }} />
                </button>
                <span className={`dot ${onCount ? 'on' : 'off'}`} aria-hidden />
                <EditableName
                  name={room}
                  className="hue-room-name"
                  label={`rommet ${room}`}
                  onRename={g && onRenameGroup ? (name) => onRenameGroup(g, name) : undefined}
                />
                <span className="muted small hue-count">{onCount ? `${onCount} av ${roomLights.length} på` : `${roomLights.length} av`}</span>
                {g && (
                  <label className="switch" title={g.on ? `Slå av ${room}` : `Slå på ${room}`}>
                    <input type="checkbox" checked={g.on} disabled={!onGroup || busyId === g.id} onChange={() => onGroup?.(g, !g.on)} aria-label={`Hele ${room}`} />
                    <span />
                  </label>
                )}
              </div>
              {isOpen && (
                <ul className="hue-lights">
                  {g && g.brightness != null && onDimGroup && (
                    <li className="hue-room-dim">
                      <span className="muted small">Hele rommet</span>
                      <Dimmer value={g.brightness} label={`Lysstyrke ${room}`} onCommit={(b) => onDimGroup(g, b)} />
                    </li>
                  )}
                  {roomLights.map((l) => (
                    <li key={l.id}>
                      <span className={`dot ${l.on ? 'on' : 'off'}`} aria-hidden />
                      <EditableName name={l.name} label={l.name} onRename={onRenameLight ? (name) => onRenameLight(l, name) : undefined} />
                      {l.brightness != null && onDimLight ? (
                        <Dimmer value={l.on ? l.brightness : 0} label={`Lysstyrke ${l.name}`} onCommit={(b) => onDimLight(l, b)} />
                      ) : (
                        <span className="muted small hue-count">{l.on ? (l.brightness != null ? `${l.brightness} %` : 'på') : ''}</span>
                      )}
                      {onIdentify && (
                        <button className="icon" aria-label={`Blink ${l.name}`} title="Blink for å finne lampen" onClick={() => onIdentify(l)}>
                          <Icon name="bulb" />
                        </button>
                      )}
                      <label className="switch sm" title={l.on ? 'Slå av' : 'Slå på'}>
                        <input type="checkbox" checked={l.on} disabled={!onToggle || busyId === l.id} onChange={() => onToggle?.(l)} aria-label={l.name} />
                        <span />
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Navn med blyant-knapp; Enter lagrer, Esc avbryter. Uten onRename vises bare teksten. */
function EditableName({ name, label, className = '', onRename }: { name: string; label: string; className?: string; onRename?: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft != null) {
    const save = () => {
      const v = draft.trim();
      setDraft(null);
      if (v && v !== name) onRename?.(v);
    };
    return (
      <input
        className="name-input"
        value={draft}
        maxLength={32}
        autoFocus
        aria-label={`Nytt navn for ${label}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    );
  }
  return (
    <span className={`editable-name ${className}`}>
      <strong>{name}</strong>
      {onRename && (
        <button className="icon" aria-label={`Gi nytt navn til ${label}`} title="Gi nytt navn" onClick={() => setDraft(name)}>
          <Icon name="pencil" />
        </button>
      )}
    </span>
  );
}

/** Glidebryter 1–100 %. Viser verdien mens man drar, sender først når man slipper (eller etter kort opphold). */
export function Dimmer({ value, label, onCommit }: { value: number; label: string; onCommit: (brightness: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const shown = draft ?? value;
  const commit = (v: number) => {
    window.clearTimeout(timer.current);
    setDraft(null);
    if (v !== value) onCommit(Math.max(1, v));
  };
  return (
    <span className="dimmer">
      <input
        type="range"
        min={1}
        max={100}
        value={Math.max(1, shown)}
        aria-label={label}
        style={{ '--fill': `${Math.max(1, shown)}%` } as React.CSSProperties}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDraft(v);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commit(v), 600);
        }}
        onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
      />
      <span className="muted small dimmer-value">{shown > 0 ? `${shown} %` : 'av'}</span>
    </span>
  );
}
