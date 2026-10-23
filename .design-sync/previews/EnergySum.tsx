import { EnergySum } from 'mill-dashboard';
import { installMockFetch } from './_mock';

installMockFetch();

// Mill-timestatistikk er POST med period i body – svar med en dag i timer (millisekunder, som ekte Mill)
const base = window.fetch;
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/\/statistics$/.test(url) && String(init?.body ?? '').includes('"hourly"')) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const wh = [90, 90, 85, 88, 92, 420, 740, 810, 300, 80, 95, 90, 100, 95, 310, 600, 820, 880, 840, 690, 700, 650, 200];
    const items = wh.slice(0, new Date().getHours() + 1).map((value, h) => {
      const start = day.getTime() + h * 3_600_000;
      return { startTimestamp: start, endTimestamp: start + 3_600_000, startPeriod: new Date(start).toISOString(), value, lostStatisticData: false };
    });
    return new Response(JSON.stringify({ houseId: 'house-1', valueTotal: 0, electricityPriceTotal: 0, pricePerKWhAvg: null, energyUsage: { items }, roomList: [] }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  return base(input, init);
}) as typeof fetch;

export const Today = () => <div style={{ maxWidth: 760 }}><EnergySum houseId="house-1" /></div>;
