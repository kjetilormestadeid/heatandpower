import { ActiveNowView, type ActiveDevice } from 'mill-dashboard';

const dev = (id: string, name: string, room: string | null, type: string, power: number, over: Partial<ActiveDevice> = {}): ActiveDevice =>
  ({ id, name, room, type, power, isConnected: true, isEnabled: true, ...over });

const evening: ActiveDevice[] = [
  dev('1', 'Gulvvarme kjøkken', 'Stue og kjøkken', 'Sockets', 1520),
  dev('2', 'Panelovn kjeller', 'Kjeller og TV-stue', 'Heaters', 820),
  dev('3', 'Avfukter', null, 'Sockets', 154),
  dev('4', 'Ovn soverom', 'Soverom', 'Heaters', 0),
  dev('5', 'Gulv Julie', 'Julies rom', 'Sockets', 0),
  dev('6', 'Gang sov', 'Gang ved soverom', 'Heaters', 0, { isEnabled: false }),
  dev('7', 'Viktor varmeovn', 'Viktors rom', 'Heaters', 640, { isConnected: false }),
];

const quiet: ActiveDevice[] = [
  dev('1', 'Ovn soverom', 'Soverom', 'Heaters', 0),
  dev('2', 'Panelovn kjeller', 'Kjeller og TV-stue', 'Heaters', 0),
  dev('3', 'Avfukter', null, 'Sockets', 0, { isEnabled: false }),
];

export const Evening = () => <section className="card active-now" style={{ maxWidth: 640 }}><ActiveNowView devices={evening} /></section>;

export const NothingDrawing = () => <section className="card active-now" style={{ maxWidth: 640 }}><ActiveNowView devices={quiet} /></section>;

export const WithTibberPulse = () => (
  <section className="card active-now" style={{ maxWidth: 640 }}>
    <ActiveNowView devices={evening} house={{ power: 8814, accumulatedConsumption: 94.4, accumulatedCost: 173.9, maxPower: 16433 }} />
  </section>
);
