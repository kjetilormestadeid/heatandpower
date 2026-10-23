import { ChargerView, type EaseeChargerData } from 'mill-dashboard';

const day = new Date();
day.setHours(0, 0, 0, 0);
const hourly = (kwhByHour: number[]) =>
  kwhByHour.map((v, h) => ({
    from: new Date(day.getTime() + h * 3_600_000).toISOString(),
    to: new Date(day.getTime() + (h + 1) * 3_600_000).toISOString(),
    totalEnergy: v,
  }));
const night = [7.1, 7.2, 7.2, 7.1, 6.8, 2.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3.6, 7.0];

const state = (over: Partial<EaseeChargerData['state']>): EaseeChargerData['state'] => ({
  chargerOpMode: 3, totalPower: 7.2, sessionEnergy: 14.8, outputCurrent: 10.4, dynamicChargerCurrent: 32,
  cableLocked: true, isOnline: true, latestPulse: new Date().toISOString(), ...over,
});

const noop = () => {};
const Card = ({ data }: { data: EaseeChargerData }) => (
  <section className="card energy" style={{ maxWidth: 640 }}>
    <div className="charger"><ChargerView data={data} name="Garasje" onCommand={noop} /></div>
  </section>
);

export const Charging = () => <Card data={{ state: state({}), hourly: hourly(night) }} />;
export const ReadyToCharge = () => <Card data={{ state: state({ chargerOpMode: 6, totalPower: 0, outputCurrent: 0, sessionEnergy: 37.6 }), hourly: hourly(night.slice(0, 6)) }} />;
export const NoCar = () => <Card data={{ state: state({ chargerOpMode: 1, totalPower: 0, sessionEnergy: 37.6, cableLocked: false }), hourly: [] }} />;
