import { HueView } from 'mill-dashboard';

const lights = [
  { id: '1', name: 'Taklampe', room: 'Stue', on: true, brightness: 80 },
  { id: '2', name: 'Leselampe', room: 'Stue', on: true, brightness: 45 },
  { id: '3', name: 'Vinduslampe', room: 'Stue', on: false, brightness: 100 },
  { id: '4', name: 'Spotter', room: 'Kjøkken', on: true, brightness: 100 },
  { id: '5', name: 'Nattbord Hege', room: 'Soverom', on: false, brightness: 30 },
  { id: '6', name: 'Nattbord Kjetil', room: 'Soverom', on: true, brightness: 15 },
  { id: '7', name: 'Hagelys', room: 'Ute', on: true, brightness: 100 },
];
const groups = [
  { id: 'g0', name: 'Alle lys', kind: 'home' as const, on: true, lights: 7, resourceId: null, brightness: 70 },
  { id: 'g1', name: 'Kjøkken', kind: 'room' as const, on: true, lights: 1, resourceId: 'r', brightness: 70 },
  { id: 'g2', name: 'Soverom', kind: 'room' as const, on: true, lights: 2, resourceId: 'r', brightness: 70 },
  { id: 'g3', name: 'Stue', kind: 'room' as const, on: true, lights: 3, resourceId: 'r', brightness: 70 },
  { id: 'g4', name: 'Ute', kind: 'room' as const, on: true, lights: 1, resourceId: 'r', brightness: 70 },
];

export const Evening = () => (
  <section className="card energy" style={{ maxWidth: 760 }}><HueView lights={lights} groups={groups} defaultOpen={['Stue', 'Soverom']} onToggle={() => {}} onGroup={() => {}} onRenameLight={() => {}} onRenameGroup={() => {}} onIdentify={() => {}} onDimLight={() => {}} onDimGroup={() => {}} /></section>
);

export const AllOff = () => (
  <section className="card energy" style={{ maxWidth: 760 }}>
    <HueView lights={lights.map((l) => ({ ...l, on: false }))} groups={groups.map((g) => ({ ...g, on: false }))} onToggle={() => {}} onGroup={() => {}} onRenameLight={() => {}} onRenameGroup={() => {}} />
  </section>
);
