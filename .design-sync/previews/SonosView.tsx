import { SonosView } from 'mill-dashboard';

const data = {
  householdId: 'h1',
  groups: [
    { id: 'g1', name: 'Stue', players: ['Stue', 'Kjøkken'], playerIds: ['p1', 'p2'], state: 'playing' as const, track: { title: 'Hey Jude', artist: 'The Beatles', source: 'Spotify', image: null }, volume: 32, muted: false },
    { id: 'g2', name: 'Kjeller', players: ['Kjeller'], playerIds: ['p3'], state: 'playing' as const, track: { title: 'Dagsnytt', artist: null, source: 'NRK P2', image: null }, volume: 18, muted: false },
    { id: 'g3', name: 'Bad', players: ['Bad'], playerIds: ['p4'], state: 'paused' as const, track: { title: 'Morgenpodden', artist: 'NRK', source: null, image: null }, volume: 25, muted: false },
    { id: 'g4', name: 'Terrasse', players: ['Terrasse'], playerIds: ['p5'], state: 'idle' as const, track: null, volume: 40, muted: false },
  ],
  favorites: [{ id: 'f1', name: 'NRK P1', image: null }, { id: 'f2', name: 'Kveldsjazz', image: null }],
};
const noop = () => {};

export const Evening = () => (
  <section className="card energy" style={{ maxWidth: 760 }}>
    <SonosView data={data} onCommand={noop} onVolume={noop} onFavorite={noop} onPauseAll={noop} />
  </section>
);

export const AllQuiet = () => (
  <section className="card energy" style={{ maxWidth: 760 }}>
    <SonosView data={{ ...data, groups: data.groups.map((g) => ({ ...g, state: 'idle' as const, track: null })) }} onCommand={noop} onVolume={noop} onFavorite={noop} onPauseAll={noop} />
  </section>
);
