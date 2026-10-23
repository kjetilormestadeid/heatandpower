import { DayBar } from 'mill-dashboard';

const workday = [{ min: 0, mode: 'sleep' as const }, { min: 360, mode: 'comfort' as const }, { min: 510, mode: 'away' as const }, { min: 960, mode: 'comfort' as const }, { min: 1350, mode: 'sleep' as const }];
const weekend = [{ min: 0, mode: 'sleep' as const }, { min: 480, mode: 'comfort' as const }, { min: 1410, mode: 'sleep' as const }];
const boost = [{ min: 0, mode: 'off' as const }, { min: 300, mode: 'always_heating' as const }, { min: 420, mode: 'normal' as const }, { min: 1200, mode: 'off' as const }];

const Row = ({ label, entries }: { label: string; entries: typeof workday }) => (
  <div className="week-row" style={{ width: 420 }}>
    <span className="muted small">{label}</span>
    <DayBar entries={entries} />
  </div>
);

export const Workday = () => <Row label="Man" entries={workday} />;
export const Weekend = () => <Row label="Lør" entries={weekend} />;
export const AllModes = () => <Row label="Ons" entries={boost} />;
