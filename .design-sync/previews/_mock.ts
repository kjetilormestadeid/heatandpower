// Shared preview fixtures: realistic Mill + Tibber data and a fetch stub so the
// data-fetching components render their loaded state in static preview cards.
// Not a component preview itself (only <Name>.tsx files are previews).
import type {
  Device,
  DeviceTimer,
  HouseStatistics,
  Room,
  ProgramMode,
  RoomProgram,
  TibberConsumption,
  TibberOverview,
  TibberPrice,
} from '../../src/types';

const HOUSE = 'house-1';
const DAY = 86_400_000;
const midnight = (offsetDays = 0) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY);
};
// Deterministic "noise" so cards look the same on every render.
const wave = (i: number, a: number, b: number) => a + (b - a) * (0.5 + 0.5 * Math.sin(i * 1.7) * Math.cos(i * 0.6));

export const rooms: Room[] = [
  room('room-stue', 'Stue', { averageTemperature: 21.4, roomHumidity: 38, roomHeatStatus: true, roomEnergyUsage: 4820, roomProgramId: 'prog-std', roomProgramName: 'Hverdag', activeModeFromWeeklyProgram: 'comfort' }),
  room('room-sov', 'Soverom', { averageTemperature: 17.8, roomHumidity: 44, roomEnergyUsage: 1630, roomProgramId: 'prog-natt', roomProgramName: 'Soverom', activeModeFromWeeklyProgram: 'sleep' }),
  room('room-bad', 'Bad', { averageTemperature: 23.1, roomHumidity: 61, roomOpenWindowStatus: true, roomEnergyUsage: 2210, mode: 'comfort', overrideModeType: 'not_continuous', overrideEndDate: Math.floor(Date.now() / 1000) + 3 * 3600 }),
  room('room-kontor', 'Kontor', { averageTemperature: null, roomHumidity: null, isRoomOnline: false, roomOnlineDevicesNumber: 0, roomEnergyUsage: 0 }),
];

function room(id: string, name: string, over: Partial<Room>): Room {
  return {
    id, name, houseId: HOUSE,
    roomComfortTemperature: 21, roomSleepTemperature: 17, roomAwayTemperature: 12,
    mode: 'weekly_program', activeModeFromWeeklyProgram: 'comfort',
    overrideModeType: null, overrideEndDate: null,
    roomProgramId: null, roomProgramName: null,
    averageTemperature: 20.5, roomHumidity: 40,
    roomHeatStatus: false, roomOpenWindowStatus: false, isRoomOnline: true,
    roomOnlineDevicesNumber: 2, roomTotalDevicesNumber: 2,
    roomEnergyUsage: 1500, roomMaxTemperature: '35', changeTemperature: true,
    ...over,
  };
}

export const devices: Device[] = [
  device('dev-1', 'Ovn under vinduet', 'room-stue', { temperatureAmbient: 21.3, currentPower: 1180 }, 3120),
  device('dev-2', null, 'room-stue', { temperatureAmbient: 21.6, currentPower: 0 }, 1700, { isEnabled: false }),
  device('dev-5', 'Bad gulvvarme', 'room-bad', { temperatureAmbient: 23, currentPower: 450 }, 2210),
  device('dev-6', 'Soverom', 'room-sov', { temperatureAmbient: 17.8, currentPower: 0 }, 1630),
  device('dev-3', 'Gangen', null, { temperatureAmbient: 18.9, currentPower: 640 }, 980),
  device('dev-4', 'Kjeller', null, {}, 0, { isConnected: false }),
];

function device(id: string, customName: string | null, roomId: string | null, m: Device['lastMetrics'], wh: number, over: Partial<Device> = {}): Device {
  return {
    deviceId: id, customName, houseId: HOUSE, roomId,
    isConnected: true, isEnabled: true,
    deviceType: { childType: { id: 'gen3', name: 'Mill Panel Heater Gen. 3' }, parentType: { id: 'heaters', name: 'Panel Heaters' } },
    lastMetrics: m, energyUsageForCurrentDay: wh,
    ...over,
  };
}

const e = (startTime: string, temperatureType: ProgramMode) => ({ startTime, temperatureType });
const weekday = [e('0:00', 'sleep'), e('6:00', 'comfort'), e('8:30', 'away'), e('16:00', 'comfort'), e('22:30', 'sleep')];
const weekend = [e('0:00', 'sleep'), e('8:00', 'comfort'), e('23:30', 'sleep')];
export const programs: RoomProgram[] = [
  { id: 'prog-std', name: 'Hverdag', houseId: HOUSE, isDefault: true,
    data: { monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday, saturday: weekend, sunday: weekend } },
  { id: 'prog-natt', name: 'Soverom', houseId: HOUSE, isDefault: false,
    data: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [e('0:00', 'sleep'), e('7:00', 'away'), e('21:00', 'comfort'), e('23:00', 'sleep')]])) },
];

export const timers: DeviceTimer[] = [
  { id: 't1', name: 'Morgen', deviceId: 'dev-3', activationTime: 360, repeatOn: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], setting: 'always_heating', isActive: true, createdAt: '2026-10-01T10:00:00Z' },
  { id: 't2', name: 'Morgen slutt', deviceId: 'dev-3', activationTime: 480, repeatOn: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], setting: 'off', isActive: true, createdAt: '2026-10-01T10:00:00Z' },
  { id: 't3', name: 'Helg', deviceId: 'dev-3', activationTime: 540, repeatOn: ['Saturday', 'Sunday'], setting: 'normal', isActive: false, createdAt: '2026-10-01T10:00:00Z' },
];

/** Mill daily statistics (Wh) for the 31 days up to today. */
export function millStats(): HouseStatistics {
  const items = Array.from({ length: 31 }, (_, i) => {
    const start = midnight(i - 30);
    return {
      // Mill sender millisekunder (ikke sekunder) – speil det ekte formatet
      startTimestamp: start.getTime(),
      endTimestamp: start.getTime() + DAY,
      startPeriod: start.toISOString(),
      value: Math.round(wave(i, 9_000, 21_000)),
      lostStatisticData: false,
    };
  });
  const valueTotal = items.reduce((s, x) => s + x.value, 0);
  return {
    houseId: HOUSE, valueTotal,
    electricityPriceTotal: (valueTotal / 1000) * 1.12, pricePerKWhAvg: 1.12,
    energyUsage: { items },
    roomList: [
      { roomId: 'room-stue', roomName: 'Stue', valueTotal: valueTotal * 0.46, percent: 46 },
      { roomId: 'room-bad', roomName: 'Bad', valueTotal: valueTotal * 0.24, percent: 24 },
      { roomId: 'room-sov', roomName: 'Soverom', valueTotal: valueTotal * 0.18, percent: 18 },
      { roomId: 'room-kontor', roomName: 'Kontor', valueTotal: valueTotal * 0.12, percent: 12 },
    ],
  };
}

/** Tibber whole-house daily consumption (kWh) for the 30 days before today. */
export function tibberDaily(): TibberConsumption[] {
  const stats = millStats().energyUsage.items;
  return Array.from({ length: 30 }, (_, i) => {
    const from = midnight(i - 30);
    const millKwh = stats[i].value / 1000;
    const consumption = Math.round((millKwh + wave(i + 3, 14, 26)) * 10) / 10;
    const unitPrice = Math.round(wave(i + 7, 0.62, 1.68) * 100) / 100;
    return {
      from: from.toISOString(), to: new Date(from.getTime() + DAY).toISOString(),
      consumption, unitPrice, cost: Math.round(consumption * unitPrice * 100) / 100,
      consumptionUnit: 'kWh', currency: 'NOK',
    };
  });
}

/** Tibber whole-house hourly consumption for today, up to (not including) the current hour. */
export function tibberHourly(): TibberConsumption[] {
  const kwh = [8.9, 7.6, 4.1, 3.4, 3.2, 3.3, 3.5, 4.8, 4.2, 3.7, 2.9, 2.2, 1.4, 1.9, 2.6, 3.3, 3.9, 5.1, 4.3, 4.0, 3.6, 3.9, 3.1, 2.8];
  return kwh.slice(0, Math.max(0, new Date().getHours() - 1)).map((consumption, h) => {
    const from = new Date(midnight().getTime() + h * 3_600_000);
    return { from: from.toISOString(), to: new Date(from.getTime() + 3_600_000).toISOString(), consumption, unitPrice: 1.2, cost: consumption * 1.2, consumptionUnit: 'kWh', currency: 'NOK' };
  });
}

function prices(dayOffset: number): TibberPrice[] {
  return Array.from({ length: 24 }, (_, h) => {
    const startsAt = new Date(midnight(dayOffset).getTime() + h * 3_600_000).toISOString();
    const morning = Math.exp(-((h - 8) ** 2) / 6);
    const evening = Math.exp(-((h - 18) ** 2) / 8);
    const total = Math.round((0.55 + 0.9 * morning + 1.1 * evening + 0.08 * dayOffset) * 1000) / 1000;
    const level: TibberPrice['level'] = total < 0.7 ? 'VERY_CHEAP' : total < 0.9 ? 'CHEAP' : total < 1.3 ? 'NORMAL' : total < 1.6 ? 'EXPENSIVE' : 'VERY_EXPENSIVE';
    return { total, energy: total * 0.7, tax: total * 0.3, startsAt, level, currency: 'NOK' };
  });
}

export function tibberOverview(): TibberOverview {
  const today = prices(0);
  const h = new Date().getHours();
  return {
    id: 'tibber-home-1', timeZone: 'Europe/Oslo', appNickname: 'Hjemme',
    currentSubscription: { status: 'running', priceInfo: { current: today[h], today, tomorrow: prices(1) } },
    daily: { nodes: tibberDaily() },
    hourly: { nodes: tibberHourly() },
  };
}

/** Easee charger currently charging, with tonight's hourly usage. */
export function easeeCharger() {
  const day = midnight();
  const kwh = [7.1, 7.2, 7.2, 7.1, 6.8, 2.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3.6, 7.0];
  return {
    state: { chargerOpMode: 3, totalPower: 7.2, sessionEnergy: 14.8, outputCurrent: 10.4, dynamicChargerCurrent: 32, cableLocked: true, isOnline: true, latestPulse: new Date().toISOString() },
    hourly: kwh.map((v, h) => ({ from: new Date(day.getTime() + h * 3_600_000).toISOString(), to: new Date(day.getTime() + (h + 1) * 3_600_000).toISOString(), totalEnergy: v })),
  };
}

export const hueLights = [
  { id: 'h1', name: 'Taklampe', room: 'Stue', on: true, brightness: 80 },
  { id: 'h2', name: 'Leselampe', room: 'Stue', on: false, brightness: 100 },
  { id: 'h3', name: 'Spotter', room: 'Kjøkken', on: true, brightness: 100 },
  { id: 'h4', name: 'Nattbord', room: 'Soverom', on: false, brightness: 30 },
];

const ROUTES: [RegExp, (url: string) => unknown][] = [
  [/\/api\/tibber\/live$/, () => ({ live: { timestamp: new Date().toISOString(), power: 6120, accumulatedConsumption: 61.3, accumulatedCost: 112.4, minPower: 570, averagePower: 3900, maxPower: 11800, currency: 'NOK' }, error: null })],
  [/\/api\/hue\/status$/, () => ({ configured: true, connected: true })],
  [/\/api\/hue\/lights$/, () => ({ lights: hueLights })],
  [/\/api\/hue\/groups$/, () => ({
    groups: [
      { id: 'hg0', name: 'Alle lys', kind: 'home', on: true, lights: hueLights.length, resourceId: null },
      { id: 'hg1', name: 'Kjøkken', kind: 'room', on: true, lights: 1, resourceId: 'r1' },
      { id: 'hg2', name: 'Soverom', kind: 'room', on: false, lights: 1, resourceId: 'r2' },
      { id: 'hg3', name: 'Stue', kind: 'room', on: true, lights: 2, resourceId: 'r3' },
    ],
  })],
  [/\/api\/easee\/status$/, () => ({ configured: true })],
  [/\/api\/easee\/chargers$/, () => ({ chargers: [{ id: 'EH123456', name: 'Garasje', productCode: 1 }] })],
  [/\/api\/easee\/chargers\/[^/]+$/, easeeCharger],
  [/\/api\/auth\/me$/, () => ({ login: 'kari@example.no' })],
  [/\/api\/tibber\/status$/, () => ({ configured: true })],
  [/\/api\/tibber\/homes$/, () => ({ homes: [{ id: 'tibber-home-1', appNickname: 'Hjemme', address: { address1: 'Storgata 12' } }] })],
  [/\/api\/tibber\/homes\/[^/?]+/, tibberOverview],
  [/\/houses$/, () => ({ ownHouses: [{ id: HOUSE, name: 'Hytta på Geilo', timezone: 'Europe/Oslo', mode: 'weekly_program', isVacationModeActive: false }], sharedHouses: [] })],
  [/\/houses\/[^/]+\/rooms$/, () => ({ rooms, independentDeviceIds: ['dev-3', 'dev-4'] })],
  [/\/houses\/[^/]+\/roomPrograms$/, () => ({ items: programs })],
  [/\/houses\/[^/]+\/statistics$/, millStats],
  [/\/houses\/[^/]+\/devices\/independent/, () => ({ items: devices.filter((d) => !d.roomId) })],
  [/\/rooms\/([^/]+)\/devices$/, (url) => {
    const id = url.match(/\/rooms\/([^/]+)\/devices$/)![1];
    return { ...rooms.find((r) => r.id === id)!, devices: devices.filter((d) => d.roomId === id) };
  }],
  [/\/devices\/[^/]+\/timers$/, () => ({ items: timers })],
];

/** Replace window.fetch with fixture responses. `delayMs: Infinity` keeps requests pending (loading state). */
export function installMockFetch({ delayMs = 0, fail }: { delayMs?: number; fail?: string } = {}) {
  window.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (delayMs === Infinity) return new Promise<Response>(() => {});
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (fail) return json({ error: { message: fail } }, 502);
    const hit = ROUTES.find(([rx]) => rx.test(url));
    return hit ? json(hit[1](url)) : json(null, 204);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
