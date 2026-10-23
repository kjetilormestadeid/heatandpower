import { Icon, type IconName } from 'mill-dashboard';

const ALL: IconName[] = ['flame', 'droplet', 'bolt', 'pencil', 'close', 'minus', 'plus', 'chevron-left', 'chevron-right', 'thermometer', 'window', 'plug'];

export const AllIcons = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 72px)', gap: 12 }}>
    {ALL.map((n) => (
      <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <Icon name={n} size={22} />
        <span className="muted small">{n}</span>
      </div>
    ))}
  </div>
);

export const InContext = () => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
    <span className="pill heat"><Icon name="flame" /> Varmer</span>
    <span className="pill warn"><Icon name="window" /> Åpent vindu</span>
    <span className="pill on"><Icon name="bolt" /> Lader</span>
    <span className="with-icon"><Icon name="droplet" /> 38 %</span>
    <button aria-label="Forrige måned"><Icon name="chevron-left" /></button>
    <button className="icon" aria-label="Fjern"><Icon name="close" /></button>
  </div>
);
