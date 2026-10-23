import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { DecoClient, DecoOverview, Person } from '../types';
import { Icon } from './Icon';

const POLL_MS = 60_000;

// Deco sine kategorinavn (engelsk) -> norsk
const TYPE_LABEL: Record<string, string> = {
  Mobile: 'Mobil',
  Laptop: 'Laptop',
  Tablet: 'Nettbrett',
  Computer: 'PC',
  'Speaker/Amp': 'Høyttaler',
  'Smart Device': 'Smartenhet',
  'Smart Appliance': 'Hvitevare',
  'Media Player': 'Mediaspiller',
  'Streaming Dongle': 'Strømmepinne',
  Doorbell: 'Ringeklokke',
  Controller: 'Kontroller',
  Network: 'Nettverk',
  Printer: 'Skriver',
  HVAC: 'Varme/ventilasjon',
  Car: 'Bil',
  TV: 'TV',
  Camera: 'Kamera',
  Other: 'Annet',
};
/** Telefoner er det som sier noe om hvem som er hjemme */
const isPhone = (t: string | null) => t === 'Mobile' || t === 'phone';
const typeLabel = (t: string | null) => (t ? (TYPE_LABEL[t] ?? t) : 'Ukjent');

const since = (iso: string | null) => {
  if (!iso) return 'aldri sett';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return `sist sett ${today ? '' : d.toLocaleDateString('nb-NO', { weekday: 'short' }) + ' '}kl. ${d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}`;
};

/** «Hvem er hjemme»: personer (koblet til telefonene sine) og alle enheter på Deco-nettet. */
export function PresenceSection() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [data, setData] = useState<DecoOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.decoOverview().then((d) => (setData(d), setError(null)), (e) => setError(e.message)), []);

  useEffect(() => {
    api.decoStatus().then((s) => setConfigured(s.configured), (e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!configured) return;
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    return () => clearInterval(t);
  }, [configured, load]);

  async function setOwner(c: DecoClient, name: string) {
    try {
      const r = await api.decoSetOwner(c.mac, name);
      setData((d) => (d ? { ...d, people: r.people } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke lagre');
    }
  }

  if (configured === null && !error) return null;

  return (
    <section className="card energy">
      <div className="section-head">
        <h2>Hvem er hjemme</h2>
        <span className="muted small">via Deco-wifi</span>
      </div>
      {error && <p className="error small">{error}</p>}
      {configured === false && (
        <p className="small" style={{ margin: 0 }}>
          Legg inn <code>DECO_PASSWORD</code> (og ev. <code>DECO_HOST</code>) i <code>.env</code>. Backend må kjøre på hjemmenettet.
        </p>
      )}
      {configured && !data && !error && <p className="muted small">Henter fra Deco…</p>}
      {data && <PresenceView data={data} onSetOwner={setOwner} />}
    </section>
  );
}

/** Ren visning: personer hjemme/borte, og enheter på nettet med mulighet for å koble dem til en person. */
export function PresenceView({ data, onSetOwner }: { data: DecoOverview; onSetOwner?: (c: DecoClient, name: string) => void }) {
  const [showAll, setShowAll] = useState(data.people.length === 0);
  const owner = new Map(data.people.flatMap((p) => p.macs.map((m) => [m, p.name] as const)));
  const names = data.people.map((p) => p.name);
  // Telefoner først – det er de som sier noe om hvem som er hjemme
  const clients = [...data.clients].sort((a, b) => Number(isPhone(b.type)) - Number(isPhone(a.type)) || a.name.localeCompare(b.name, 'nb'));
  const home = data.people.filter((p) => p.home);

  return (
    <>
      {data.people.length > 0 ? (
        <div className="people">
          {data.people.map((p) => (
            <PersonChip key={p.name} person={p} />
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          Koble telefonene til personer i listen under, så vises hvem som er hjemme.
        </p>
      )}

      <div className="tiles">
        {data.people.length > 0 && (
          <div className="tile">
            <span className="muted small">Hjemme nå</span>
            <strong>{home.length ? `${home.length} av ${data.people.length}` : 'Ingen'}</strong>
          </div>
        )}
        <div className="tile">
          <span className="muted small">Enheter på nettet</span>
          <strong>{data.clients.length}</strong>
        </div>
        <div className="tile">
          <span className="muted small">Deco-enheter</span>
          <strong>
            {data.decos.filter((d) => d.online).length} av {data.decos.length} på nett
          </strong>
        </div>
      </div>

      <button className="link" onClick={() => setShowAll((s) => !s)}>
        {showAll ? 'Skjul enheter' : `Vis alle ${data.clients.length} enheter`}
      </button>
      <datalist id="people-names">
        {names.map((n) => <option key={n} value={n} />)}
      </datalist>
      {showAll && (
        <ul className="net-list">
          {clients.map((c) => (
            <li key={c.mac}>
              <div className="net-name">
                <strong>{c.name}</strong>
                <span className="muted small">
                  {typeLabel(c.type)} · {c.wired ? 'kablet' : 'wifi'}{c.deco ? ` · ${c.deco}` : ''}{c.guest ? ' · gjest' : ''}{c.ip ? ` · ${c.ip}` : ''}
                </span>
              </div>
              {onSetOwner ? (
                <OwnerInput value={owner.get(c.mac) ?? ''} onCommit={(name) => onSetOwner(c, name)} />
              ) : (
                owner.get(c.mac) && <span className="pill on">{owner.get(c.mac)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PersonChip({ person }: { person: Person }) {
  return (
    <div className={`person ${person.home ? 'home' : ''}`} title={person.macs.length > 1 ? `${person.macs.length} enheter` : undefined}>
      <span className="person-avatar" aria-hidden>{person.name.slice(0, 1).toUpperCase()}</span>
      <div className="person-text">
        <strong>{person.name}</strong>
        <span className="muted small">{person.home ? 'Hjemme' : `Borte · ${since(person.lastSeen)}`}</span>
      </div>
    </div>
  );
}

/** Tekstfelt med forslag fra eksisterende personer; lagres ved Enter/blur. */
function OwnerInput({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft.trim() !== value && onCommit(draft.trim());
  return (
    <label className="owner-input">
      <Icon name="pencil" aria-hidden />
      <input
        list="people-names"
        placeholder="Hvem eier denne?"
        value={draft}
        maxLength={40}
        aria-label="Eier av enheten"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}
