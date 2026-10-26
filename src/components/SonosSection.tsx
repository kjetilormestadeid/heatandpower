import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { SonosCommand, SonosGroup, SonosOverview } from '../types';
import { Dimmer } from './HueSection';
import { Icon } from './Icon';
import { retryUntilOk } from '../useServicePoll';

const POLL_MS = 60_000; // Sonos: maks 20 000 kall/døgn – serveren holder oversikten i 90 s uansett

/** Sonos via Control API: koble til én gang, deretter rom/grupper med avspilling, volum og favoritter. */
export function SonosSection() {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [data, setData] = useState<SonosOverview | null>(null);
  const [error, setError] = useState<string | null>(() => new URLSearchParams(location.search).get('sonos_error'));
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.sonosOverview().then((d) => (setData(d), setError(null)), (e) => setError(e.message)), []);

  useEffect(() => {
    let failed = false;
    const stop = retryUntilOk(() =>
      api.sonosStatus().then(
        (s) => (setStatus(s), failed && setError(null)),
        (e) => {
          failed = true;
          setError(e.message);
          throw e;
        },
      ),
    );
    if (location.search.includes('sonos')) history.replaceState(null, '', location.pathname);
    return stop;
  }, []);

  useEffect(() => {
    if (!status?.connected) return;
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    return () => clearInterval(t);
  }, [status?.connected, load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Noe gikk galt');
    } finally {
      await load();
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await api.sonosComplete(pasted);
      setPasted('');
      setStatus((s) => (s ? { ...s, connected: true } : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunne ikke fullføre innloggingen');
    } finally {
      setBusy(false);
    }
  }

  if (!status && !error) return null;

  return (
    <section className="card energy">
      <div className="section-head">
        <h2>Musikk (Sonos)</h2>
        <div className="spacer" />
        {status?.connected && (
          <button className="link small disconnect" onClick={() => api.sonosLogout().then(() => (setStatus({ ...status, connected: false }), setData(null)))}>
            Koble fra
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}

      {status && !status.configured && (
        <p className="small" style={{ margin: 0 }}>
          Lag en «Control Integration» på{' '}
          <a href="https://developer.sonos.com" target="_blank" rel="noreferrer">developer.sonos.com</a> og legg <code>SONOS_CLIENT_ID</code>,{' '}
          <code>SONOS_CLIENT_SECRET</code> og <code>SONOS_REDIRECT_URI</code> (HTTPS) i <code>.env</code>.
        </p>
      )}

      {status?.configured && !status.connected && (
        <div className="sonos-connect">
          <ol className="small">
            <li>
              <a className="button primary" href="/api/sonos/login" target="_blank" rel="noreferrer">Koble til Sonos</a> – godkjenn tilgang i fanen som åpnes.
            </li>
            <li>Du havner på redirect-adressen din. Kopier hele adressen fra adressefeltet og lim den inn her:</li>
          </ol>
          <div className="period-row">
            <input className="paste-url" placeholder="https://…?code=…&state=… (eller bare koden)" value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Adressen etter godkjenning" />
            <button className="primary" disabled={busy || !pasted.trim()} onClick={complete}>{busy ? 'Kobler til…' : 'Fullfør'}</button>
          </div>
        </div>
      )}

      {status?.connected && !data && !error && <p className="muted small">Henter fra Sonos…</p>}
      {data && (
        <SonosView
          data={data}
          busy={busy}
          onCommand={(g, c) => run(() => api.sonosCommand(g.id, c))}
          onVolume={(g, v) => run(() => api.sonosVolume(g.id, v))}
          onFavorite={(g, f) => run(() => api.sonosFavorite(g.id, f))}
          onPauseAll={() => run(() => api.sonosPauseAll())}
        />
      )}
    </section>
  );
}

const STATE_LABEL: Record<SonosGroup['state'], string> = { playing: 'Spiller', paused: 'Pause', idle: 'Stille', buffering: 'Laster…' };

/** Ren visning: rom/grupper med hva som spilles, play/pause, neste, volum og favoritter. */
export function SonosView({
  data,
  busy,
  onCommand,
  onVolume,
  onFavorite,
  onPauseAll,
}: {
  data: SonosOverview;
  busy?: boolean;
  onCommand?: (g: SonosGroup, cmd: SonosCommand) => void;
  onVolume?: (g: SonosGroup, volume: number) => void;
  onFavorite?: (g: SonosGroup, favoriteId: string) => void;
  onPauseAll?: () => void;
}) {
  const playing = data.groups.filter((g) => g.state === 'playing' || g.state === 'buffering');
  return (
    <>
      <div className="hue-summary">
        <div className="tiles">
          <div className="tile">
            <span className="muted small">Spiller nå</span>
            <strong>{playing.length ? `${playing.length} av ${data.groups.length} rom` : 'Ingenting'}</strong>
          </div>
        </div>
        {onPauseAll && (
          <div className="charger-actions">
            <button disabled={busy || playing.length === 0} onClick={onPauseAll}>Pause alt</button>
          </div>
        )}
      </div>

      <ul className="hue-list">
        {data.groups.map((g) => {
          const isPlaying = g.state === 'playing' || g.state === 'buffering';
          return (
            <li key={g.id} className="hue-row sonos-row">
              <div className="hue-row-head">
                {onCommand && (
                  <button className="icon sonos-play" aria-label={isPlaying ? `Pause ${g.name}` : `Spill ${g.name}`} disabled={busy} onClick={() => onCommand(g, isPlaying ? 'pause' : 'play')}>
                    <Icon name={isPlaying ? 'pause' : 'play'} />
                  </button>
                )}
                <div className="sonos-info">
                  <strong className="sonos-room">{g.name}</strong>
                  <span className="muted small sonos-track">
                    {g.track?.title
                      ? `${g.track.title}${g.track.artist ? ` – ${g.track.artist}` : ''}`
                      : (g.track?.source ?? STATE_LABEL[g.state])}
                    {g.players.length > 1 ? ` · ${g.players.length} høyttalere` : ''}
                  </span>
                </div>
                {onCommand && isPlaying && (
                  <button className="icon" aria-label={`Neste i ${g.name}`} disabled={busy} onClick={() => onCommand(g, 'next')}>
                    <Icon name="next" />
                  </button>
                )}
                {onFavorite && data.favorites.length > 0 && !isPlaying && (
                  <select
                    className="sonos-fav"
                    value=""
                    aria-label={`Spill favoritt i ${g.name}`}
                    disabled={busy}
                    onChange={(e) => e.target.value && onFavorite(g, e.target.value)}
                  >
                    <option value="">Favoritt…</option>
                    {data.favorites.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                )}
                {g.volume != null && onVolume ? (
                  <Dimmer value={g.muted ? 0 : g.volume} label={`Volum ${g.name}`} onCommit={(v) => onVolume(g, v)} />
                ) : (
                  <span className="muted small">{STATE_LABEL[g.state]}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
