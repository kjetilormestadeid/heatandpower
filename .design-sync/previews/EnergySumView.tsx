import { EnergySumView } from 'mill-dashboard';

// Typisk dag: elbil lader om natten, Mill varmer morgen og kveld, resten er varmtvann/komfyr.
const total = [8.9, 7.6, 4.1, 3.4, 3.2, 3.3, 3.5, 4.8, 4.2, 3.7, 2.9, 2.2, 1.4, 1.9, 2.6, 3.3, 3.9, 5.1, 4.3, 4.0, 3.6];
const mill = [0.1, 0.1, 0.1, 0.1, 0.1, 0.4, 0.7, 0.8, 0.3, 0.1, 0.1, 0.1, 0.1, 0.1, 0.3, 0.6, 0.8, 0.9, 0.8, 0.7, 0.7];
const ev = [3.1, 4.5, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const hours = [
  ...total.map((t, hour) => ({ hour, total: t, mill: mill[hour], ev: ev[hour] })),
  { hour: 21, total: null, mill: 0.7, ev: 4.6 },
  { hour: 22, total: null, mill: 0.2, ev: 2.1 },
];

export const Today = () => <section className="card energy" style={{ maxWidth: 760 }}><EnergySumView hours={hours} /></section>;

export const Morning = () => <section className="card energy" style={{ maxWidth: 760 }}><EnergySumView hours={hours.slice(0, 8)} /></section>;
