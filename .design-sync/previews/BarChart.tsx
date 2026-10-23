import { BarChart, type Bar } from 'mill-dashboard';

const hourly = [0.62, 0.58, 0.55, 0.54, 0.57, 0.71, 1.05, 1.42, 1.51, 1.18, 0.96, 0.88, 0.84, 0.81, 0.86, 0.98, 1.24, 1.66, 1.82, 1.57, 1.21, 0.98, 0.81, 0.7];
const priceBars: Bar[] = hourly.map((v, h) => ({
  key: String(h),
  value: v,
  tick: h % 3 === 0 ? String(h).padStart(2, '0') : undefined,
  state: h < 14 ? 'past' : h === 14 ? 'current' : 'normal',
  tooltip: <><div className="muted small">kl. {String(h).padStart(2, '0')}:00</div><strong>{Math.round(v * 100)} øre</strong></>,
}));

const daily = [14.2, 16.8, 15.1, 19.4, 22.7, 18.3, 12.9, 13.6, 17.2, 20.1, 21.8, 19.9, 15.4, 14.8];
const usageBars: Bar[] = daily.map((v, i) => ({
  key: String(i),
  value: v,
  tick: (i + 1) % 2 === 1 ? String(i + 1) : undefined,
  tooltip: <><div className="muted small">{i + 1}. okt</div><strong>{v.toLocaleString('nb-NO')} kWh</strong></>,
}));

export const PriceToday = () => (
  <BarChart label="Strømpris i dag" unit="øre" formatAxis={(v) => String(Math.round(v * 100))} bars={priceBars} />
);

export const PriceWithTomorrow = () => (
  <BarChart
    label="Strømpris i dag og i morgen"
    unit="øre"
    formatAxis={(v) => String(Math.round(v * 100))}
    bars={[...priceBars, ...priceBars.map((b) => ({ ...b, key: `t${b.key}`, state: 'normal' as const, value: b.value * 0.9 }))]}
    divider={{ index: 24, label: 'I morgen' }}
  />
);

export const DailyUsage = () => (
  <BarChart label="Daglig forbruk" unit="kWh" formatAxis={(v) => String(Math.round(v))} bars={usageBars} />
);
